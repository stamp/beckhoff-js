import { Socket, AddressInfo } from 'net';
import Debug from 'debug';
import Schema from 'validate';
import { EventEmitter } from 'events';
import { ConnectOptions } from './interfaces';
import { Types as ADSTypes, Command, Errors } from './ads';
import { parse, Response } from './ams';

export * from './ads';
export { Response } from './ams';
// @see https://infosys.beckhoff.com/english.php?content=../content/1033/tcadsamsspec/html/tcadsamsspec_amsheader.htm&id=
export const MAX_SAFE_INVOKEID = 2 ** 32 - 1; // 32bit => 4 bytes
export const REQUEST_TIMEOUT = 3000;

export class ADSConnection extends EventEmitter {
  private readonly logger = Debug('beckhoff-js:connection');

  private readonly requests = new EventEmitter();

  private connected = false;

  private commandHeader = Buffer.allocUnsafe(16);

  private options: ConnectOptions;

  private socket?: Socket;

  private buffer: Buffer | null = null;

  private invokeID = 1;

  private reconnectTimeout?: NodeJS.Timeout;

  constructor(options: ConnectOptions) {
    super();
    const optionsSchema = new Schema({
      source: {
        netID: { type: String },
        amsPort: { type: Number },
      },
      target: {
        host: { type: String, required: true },
        port: { type: Number },
        netID: { type: String },
        amsPort: { type: Number, required: true }
      },
      reconnect: { type: Boolean },
      reconnectInterval: { type: Number }
    });
    const errors = optionsSchema.validate(options);
    if (errors.length > 0) {
      throw new Error(`${errors[0].toString().slice(7, -1)} in options`);
    }
    this.options = {
      // Default values
      reconnect: true,
      reconnectInterval: 5000,
      ...options,
      source: {
        amsPort: 800,
        ...options.source,
      },
      target: {
        port: 48898,
        netID: `${options.target.host}.1.1`,
        ...options.target,
      },
    };
  }

  public connect() {
    this.close();
    this.socket = new Socket();
    // Disables the Nagle algorithm.
    // By default TCP connections use the Nagle algorithm, they buffer data before sending it off.
    // Setting true for noDelay will immediately fire off data each time socket.write() is called.
    this.socket.setNoDelay(true);
    this.socket.setKeepAlive(true, REQUEST_TIMEOUT);
    const { port, host } = this.options.target;
    this.logger(`Opening connection to ${host}:${port}`);
    this.socket.on('connect', this.connectHandler.bind(this));
    this.socket.on('data', this.dataHandler.bind(this));
    this.socket.on('error', this.errorHandler.bind(this));
    this.socket.on('close', this.closeHandler.bind(this));
    this.socket.connect(port || 48898, host);
  }

  public async request(command: Command, data: Buffer): Promise<Response> {
    if (!this.connected) {
      throw new Error('Not connected');
    }
    if (this.invokeID >= MAX_SAFE_INVOKEID) {
      this.invokeID = 1;
    }
    const header = Buffer.allocUnsafe(32);
    const { invokeID } = this;
    this.invokeID += 1;
    const reqId = `req:${invokeID}`;
    if (this.requests.listenerCount(reqId) > 0) {
      throw new Error(`Request with invoke ${invokeID} is allready pending`);
    }
    // Build the header
    this.commandHeader.copy(header, 0); // ams net IDs and ams ports
    header.writeUInt16LE(command, 16); // Command ID
    header.writeUInt16LE(0x0004, 18); // Flags: command + request
    header.writeUInt32LE(data.length, 20); // Data length
    header.writeUInt32LE(0x0, 24); // Error Code
    header.writeUInt32LE(invokeID, 28); // InvokeID
    // Add the request data
    const packet = Buffer.alloc(6 + header.length + data.length);
    packet.writeUInt32LE(header.length + data.length, 2);
    header.copy(packet, 6);
    data.copy(packet, 38);

    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      if (!this.socket) {
        return reject(new Error('Not connected'));
      }
      this.logger(`Waiting for request "${reqId}" response..`);

      const disconnected = () => {
        this.requests.removeAllListeners(reqId);
        return reject(new Error('Disconnected'));
      };

      const cleanup = () => {
        this.requests.removeAllListeners(reqId);
        this.removeListener('close', disconnected);
        clearTimeout(timeout);
      };

      this.once('close', disconnected);
      this.requests.once(reqId, (resp: Response) => {
        cleanup();
        this.logger(`Request "${reqId}" response received`);
        // Check if the response we got contained an error code
        if (resp.header.errorCode) {
          this.logger('Request: received ads error ', resp.header.errorCode);
          return reject(new Error(Errors[resp.header.errorCode] || `Ads error code ${resp.header.errorCode}`));
        }
        // else everything went fine and we can resolve the promise
        return resolve(resp);
      });

      timeout = setTimeout(() => {
        cleanup();
        if (!this.socket) {
          return reject(new Error('Not connected'));
        }
        return reject(new Error('Request timeout'));
      }, REQUEST_TIMEOUT);

      this.logger('Send Request: ', packet, packet.length);
      return this.socket.write(packet);
    });
  }

  public isConnected() {
    return !!(this.socket && this.connected);
  }

  public isConnecting() {
    return !!(this.socket && this.socket.connecting);
  }

  public async close() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.end();
    }
  }

  private async connectHandler() {
    try {
      if (!this.socket) {
        throw new Error('Not connected');
      }
      const { port, address } = this.socket.address() as AddressInfo;
      if (!this.options.source.netID) {
        this.options.source.netID = `${address}.1.1`;
      }
      (this.options.target.netID || '') // AMSNetID Target
        .split('.')
        .forEach((c, offset) => {
          this.commandHeader.writeUInt8(parseInt(c, 10),offset);
        });
      this.commandHeader.writeUInt16LE(this.options.target.amsPort, 6); // AMSPort Target
      (this.options.source.netID || '') // AMSNetID Source
        .split('.')
        .forEach((c,offset) => {
          this.commandHeader.writeUInt8(parseInt(c, 10),offset+8);
        });
      this.commandHeader.writeUInt16LE(this.options.source.amsPort || 800, 14); // AMSPort Source
      this.logger(`Connected to ${this.options.target.host}:${this.options.target.port} from ${address}:${port} using source netID ${this.options.source.netID}:${this.options.source.amsPort} and target netID ${this.options.target.netID}:${this.options.target.amsPort}`);
      this.connected = true;
      this.emit('connected');
    } catch (err) {
      this.emit('error', err);
    }
  }

  private async dataHandler(data: Buffer) {
    this.logger(`Received (${data.length}):`, data);
    try {
      if (this.buffer === null) {
        this.buffer = data;
      } else {
        this.buffer = Buffer.concat([this.buffer, data]);
      }
      const { buffer, packets } = parse(this.buffer);
      this.buffer = buffer;
      this.logger('Buffer: ', this.buffer, this.buffer.length);
      packets.forEach(packet => {
        const response: Response = {
          header: packet.header,
          data: packet.data || Buffer.alloc(0),
        };
        switch(packet.type) {
        case ADSTypes.DeviceNotificationResponse:
          this.emit('notification', response);
          break;
        default:
          if (packet.header.invokeId) {
            this.logger(`Received request "req:${packet.header.invokeId}"`);
            this.requests.emit(`req:${packet.header.invokeId}`, response);
          } else {
            this.logger(`Unknown message received, packet type: ${packet.type}`);
          }
        }
      });
    } catch (err) {
      this.emit('err', err);
    }
  }

  private async errorHandler(err: Error) {
    // do not try to reconnect here
    // The 'close' event will be called directly following this event.
    this.emit('error', err);
    this.logger('Socket error:', err);
  }

  private async closeHandler(hadError: boolean) {
    this.logger(`Connection closed. With error? ${hadError}`);
    this.connected = false;
    this.emit('close', hadError);
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.options.reconnect === true) {
      const timeout = this.options.reconnectInterval || 1000;
      this.logger(`try to reconect in ${timeout/1000}s`);
      this.reconnectTimeout = setTimeout(() => {
        this.emit('reconnect');
        this.logger('Reconnect....');
        try {
          this.connect();
        } catch (err) {
          this.emit('error', err);
        }
      }, timeout);
    }
  }
}
