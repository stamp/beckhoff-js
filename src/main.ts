import Debug from 'debug';
import net from 'net';
import EventEmitter from 'events';
import Schema from 'validate';
// @ts-ignore
import FileTime from 'win32filetime';

import ams, { Packet } from './ams';
import ads, { Command, Response, Errors } from './ads';

const debug = {
  connection: Debug('beckhoff-js:connection'),
  ads: Debug('beckhoff-js:ads'),
}

interface ConnectOptions {
  source: {
    netID: string;
    amsPort?: number;
  },
  target: {
    host: string;
    port?: number;
    netID?: string;
    amsPort: number;
  },
  loadSymbols: boolean;
  loadDataTypes: boolean;
  reconnect: boolean;
  reconnectInterval: number;
}
interface DeviceInfo {
  majorVersion: number;
  minorVersion: number;
  buildVersion: number;
  deviceName: string;
}
interface DeviceState {
  adsState: number;
  deviceState: number;
}
interface UploadInfo {
  symbolCount: number;
  symbolLength: number;
  dataTypeCount: number;
  dataTypeLength: number;
  extraCount: number;
  extraLength: number;
}
interface NotificationHandle {
  handle: number,
  tagName: string,
  callbacks: Array<(value:any, timestamp: number) => void>;
}
interface Connection {
  connected: boolean;

  // Device info
  deviceInfo: DeviceInfo | null;
  deviceState: DeviceState | null;

  // Upload information
  uploadInfo: UploadInfo | null;
  uploadInfoTimestamp?: number;

  symbols: SymbolsList | null,
  dataTypes: DataTypesList | null,

  notifications: { [name: string]: NotificationHandle },
}
interface SymbolsList { [name: string]: SymbolData };
interface DataTypesList { [typeId: string]: DataType }
interface SymbolData {
  group: number,
  offset: number,
  size: number,
  dataType: number,
  flags: number,
  name: string,
  systemName: string,
  type: string,
  comment: string,

  targetTag?: string;
}
interface ArrayDimention {
  start: number,
  length: number,
}
interface DataType {
  version: number,
  hashValue: number,
  typHashValue: number,
  size: number,
  offset: number,
  dataType: number,
  flags: number,

  subItemsCount: number,

  name: string,
  type: string,
  comment: string,

  arrayDimentions: Array<ArrayDimention>,
  subItems: Array<DataType>,
}
interface WriteInformation {
  offset: number,
  size: number,
  data: Buffer,
}

export default class Client {
  _socket: net.Socket | null = null;
  _emitter: EventEmitter;
  _buffer: Buffer | null = null;
  _commandHeader = Buffer.allocUnsafe(16);
  _requests:{ [handle: string]: (resp: Response) => any } = {};
  _invokeID = 1;

  private dummyServer: net.Server | null = null;
  options: ConnectOptions;
  connection: Connection = {
    connected: false,
    deviceInfo: null,
    deviceState: null,
    uploadInfo: null,
    symbols: null,
    dataTypes: null,
    notifications: {},
  };

  constructor(options: ConnectOptions) {
    this._emitter = new EventEmitter();

    const optionsSchema = new Schema({
      source: {
        netID: {
          type: String,
        },
        amsPort: {
          type: Number,
        },
      },
      target: {
        host: {
          type: String,
          required: true,
        },
        port: {
          type: Number,
        },
        netID: {
          type: String,
        },
        amsPort: {
          type: Number,
          required: true,
        }
      },
      loadSymbols: {
        type: Boolean,
      },
      loadDataTypes: {
        type: Boolean,
      },
      reconnect: {
        type: Boolean,
      },
      reconnectInterval: {
        type: Number,
      }
    });
    const errors = optionsSchema.validate(options);
    if (errors.length > 0) {
      throw new Error(`${errors[0].toString().slice(7, -1)} in options`);
    }

    this.options = {
      // Default values
      loadSymbols: true,
      loadDataTypes: true,
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

  on = (eventName: string, listener: () => any ) => this._emitter.on(eventName, listener)

  connect = () => new Promise<void>((resolve, reject) => {
    try {
      if (this._socket !== null) {
        throw new Error('disconnect before starting a new connection');
      }
      debug.connection('connect()');

      const socket = new net.Socket();
      this._socket = socket;
      this.connection.connected = false;

      // Disables the Nagle algorithm. By default TCP connections use the Nagle algorithm, they buffer data before sending it off. Setting true for noDelay will immediately fire off data each time socket.write() is called.
      socket.setNoDelay(true);

      socket.on('connect', () => {
        this.connectHandler()
          .then(() => {
            this.connection.connected = true;
          })
          .then(() => Promise.all([
              this.getDeviceInfo(),
              this.getDeviceState(),
              this.options.loadSymbols ? this.getSymbols() : undefined,
              this.options.loadDataTypes ? this.getDataTypes() : undefined,
          ]))
          .then(() => resolve())
          .catch(reject);
      });
      socket.on('data', this.dataHandler);
      socket.on('timeout', this.timeoutHandler);
      socket.on('error', this.errorHandler);
      socket.on('close', this.closeHandler);

      const {
        port,
        host,
      } = this.options.target;

      socket.connect(port || 48898, host);

    } catch (err) {
      reject(err);
    }
  })
  close = () => new Promise<void>(async (resolve, reject) => {
    try {
      debug.connection('close()');

      const notifications = Object.values(this.connection.notifications);

      const done = () =>  {
        this.connection = {
          connected: false,
          deviceInfo: null,
          deviceState: null,
          uploadInfo: null,
          symbols: null,
          dataTypes: null,
          notifications: {},
        };
        resolve();
      };

      if (this._socket) {
        // Make sure to release all notification handles before we disconnect
        Promise.all(Object.values(this.connection.notifications).map(notificationHandle => this.unsubscribe(notificationHandle.handle))).then(() => {
          if (this._socket) {
            this._socket.end();
          }
          this._socket = null;
          done();
        });
      } else {
        done();
      }
    } catch (err) {
      reject(err);
    }
  });

  request = (command: Command, data: Buffer) => new Promise<Response>((resolve, reject) => {
    try {
      const header = Buffer.allocUnsafe(32);
      const invokeID = this._invokeID++;

      // Build the header
      this._commandHeader.copy(header, 0); // ams net IDs and ams ports
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

      // Make sure we have a connection
      if (this._socket) {
        // Add a callback to our list of ongoing requests
        this._requests[`${invokeID}`] = (resp) => {
          // Check if the response we got contained an error code
          if (resp.header.errorCode) {
            debug.connection('request: received ads error ', resp.header.errorCode);
            delete this._requests[`${invokeID}`];
            throw new Error(Errors[resp.header.errorCode] || `Ads error code ${resp.header.errorCode}`);
          }

          // else everything went fine and we can resolve the promise
          resolve(resp);
        }

        // Start a timeout monitor of reach request, max 30 seconds
        setTimeout(() => {
          if (this._requests[`${invokeID}`]) {
            debug.connection('timeout invokeID', invokeID);
            delete this._requests[`${invokeID}`];
            reject(new Error("request: timeout"));
          }
        }, 30000);

        // Send the request
        debug.connection('send: ', packet, packet.length);
        this._socket.write(packet);
        return;
      }

      throw new Error('request: not connected');
    } catch (err) {
      reject(err);
    }
  })

  read = (group: number, offset: number, size: number) => new Promise<Response>((resolve, reject) => {
    try {
      debug.ads(`ADS read: ${group}, ${offset}, ${size}`);
      const data = Buffer.allocUnsafe(12);
      data.writeUInt32LE(group, 0);
      data.writeUInt32LE(offset, 4);
      data.writeUInt32LE(size, 8);

      this.request(Command.Read, data)
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  write = (group: number, offset: number, size: number, value: Buffer) => new Promise<Response>((resolve, reject) => {
    try {
      if (value.length !== size) {
        throw new Error(`expected write size (${size} bytes) and provided data (${value.length} bytes) differs in length`);
      }

      debug.ads(`ADS write: ${group}, ${offset}, ${size}`);
      const data = Buffer.allocUnsafe(12 + size);
      data.writeUInt32LE(group, 0);
      data.writeUInt32LE(offset, 4);
      data.writeUInt32LE(size, 8);
      value.copy(data, 12);

      this.request(Command.Write, data)
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  subscribe = (group: number, offset: number, size: number) => new Promise<Response>((resolve, reject) => {
    try {
      debug.ads(`ADS addDeviceNotification: g${group}, o${offset}, s${size}`);
      const transmissionMode = 4; // 3=Cyclic, 4=OnChange
      const maxDelay = 10; // At the latest after this time, the ADS Device Notification is called. The unit is 1ms.
      const cycleTime = 10; // The ADS server checks if the value changes in this time slice. The unit is 1ms

      const data = Buffer.alloc(40);
      data.writeUInt32LE(group, 0);
      data.writeUInt32LE(offset, 4);
      data.writeUInt32LE(size, 8);
      data.writeUInt32LE(transmissionMode, 12);
      data.writeUInt32LE(maxDelay, 16);
      data.writeUInt32LE(cycleTime, 20);

      this.request(Command.AddDeviceNotification, data)
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  unsubscribe = (handle: number) => new Promise<Response>((resolve, reject) => {
    try {
      debug.ads(`ADS deleteDeviceNotification: handle ${handle}`);

      const data = Buffer.alloc(4);
      data.writeUInt32LE(handle, 0);

      this.request(Command.DeleteDeviceNotification, data)
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
	})

  findTag = (tagName: string) => new Promise<SymbolData>(async (resolve, reject) => {
    try {
      debug.ads(`ADS findTag: ${tagName}`);
      if (!this.connection.symbols) {
        await this.getSymbols();
      }

      if (!this.connection.symbols) {
        throw new Error(`findTag: symbol with tag name "${tagName}" was not found`);
      }

      const systemTagName = tagName.toUpperCase();
      const tag = Object.values(this.connection.symbols).find(s => s.systemName === systemTagName.substring(0, s.systemName.length));
      if (!tag) {
        throw new Error(`findTag: symbol with tag name "${tagName}" was not found`);
      }

      tag.targetTag = systemTagName;
      resolve(tag);
    } catch (err) {
      reject(err);
    }
  })
  readTag = (tagName: string) => new Promise<any>(async (resolve, reject) => {
    try {
      const tag = await this.findTag(tagName);

      this.read(tag.group, tag.offset, tag.size)
        .then(resp => this.parse(tag, resp.data))
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  writeTag = (tagName: string, value: any) => new Promise<Response>(async (resolve, reject) => {
    try {
      const tag = await this.findTag(tagName);

      const encoded = this.encode(tag, value);
      if (encoded.offset < tag.offset || encoded.offset > tag.offset + tag.size) {
        throw new Error(`writeTag: encoded offset (${encoded.offset}) is outside of the symbol offset (${tag.offset} - ${tag.offset + tag.size})`);
      }

      this.write(tag.group, encoded.offset, encoded.size, encoded.data)
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  monitorTag = (tagName: string, callback: (value: any) => void) => new Promise<any>(async (resolve, reject) => {
    try {
      const tag = await this.findTag(tagName);

      if (this.connection.notifications[tag.name]) {
        this.connection.notifications[tag.name].callbacks.push(callback);
        return resolve(this.connection.notifications[tag.name].handle);
      }

      const resp = await
      this.subscribe(tag.group, tag.offset, tag.size)
        .then(resp => {
          const notificationHandle = {
            handle: resp.data.readUInt32LE(0),
            tagName: tag.targetTag || tag.name,
            callbacks: [
              callback
            ],
          };
          this.connection.notifications[tag.name] = notificationHandle;
          return this.connection.notifications[tag.name].handle;
        })
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  stopMonitorTag = (tagName: string, callback: (value: any) => void | undefined) => new Promise<any>(async (resolve, reject) => {
    try {
      const tag = await this.findTag(tagName);
      const notificationHandle = this.connection.notifications[tag.name];
      if (!notificationHandle) {
        return resolve();
      }

      this.unsubscribe(notificationHandle.handle)
        .then(resp => {
          delete this.connection.notifications[tag.name];
          return resp;
        })
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })

  getUploadInfo = () => new Promise<UploadInfo>((resolve, reject) => {
    try {
      // If we already have the upload information and its not to old (10s), use the cached info
      const { uploadInfoTimestamp, uploadInfo } = this.connection;
      if (uploadInfo !== null && (!uploadInfoTimestamp || (+new Date) - uploadInfoTimestamp < 10000)) {
        return resolve(uploadInfo);
      }

      // Load the upload information from the PLC
      this.read(ads.ADSIGRP.SYM_UPLOADINFO2, 0, 24)
        .then(uploadinfo2 => {
          if (uploadinfo2.data.length < 24) {
            throw new Error("getUploadInfo: did not receive the expected 24 bytes");
          }

          const uploadInfo = {
            symbolCount: uploadinfo2.data.readUInt32LE(0),
            symbolLength: uploadinfo2.data.readUInt32LE(4),
            dataTypeCount: uploadinfo2.data.readUInt32LE(8),
            dataTypeLength: uploadinfo2.data.readUInt32LE(12),
            extraCount: uploadinfo2.data.readUInt32LE(16),
            extraLength: uploadinfo2.data.readUInt32LE(20),
          };

          // Cache the upload information so we dont have to ask for it every time
          this.connection.uploadInfo = uploadInfo;
          this.connection.uploadInfoTimestamp = + new Date();
          return uploadInfo
        })
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  });

  getSymbols = () => new Promise<SymbolsList>(async (resolve, reject) => {
    try {
      debug.ads(`Read symbols`);
      const { symbolLength } = await this.getUploadInfo();

      this.read(ads.ADSIGRP.SYM_UPLOAD, 0, symbolLength)
        .then(symbolData => {
          const symbols:SymbolsList = {};
          let _buffer = symbolData.data;

          while (_buffer.length >= 26) {
            const entryLength = _buffer.readUInt32LE(0);
            if (_buffer.length >= entryLength && entryLength >= 26) {
              const entryData = _buffer.slice(4, entryLength);

              const nameLength = entryData.readUInt16LE(20);
              const typeLength = entryData.readUInt16LE(22);
              const commentLength = entryData.readUInt16LE(24);

              const sym = {
                group: entryData.readUInt32LE(0),
                offset: entryData.readUInt32LE(4),
                size: entryData.readUInt32LE(8),
                dataType: entryData.readUInt32LE(12),
                flags: entryData.readUInt32LE(16),
                name: entryData.toString('ascii', 26, 26 + nameLength),
                systemName: entryData.toString('ascii', 26, 26 + nameLength).toUpperCase(),
                type: entryData.toString('ascii', 27 + nameLength, 27 + nameLength + typeLength),
                comment: entryData.toString('ascii', 28 + nameLength + typeLength, 28 + nameLength + typeLength + commentLength)
              };

              symbols[sym.name] = sym;
              _buffer = _buffer.slice(entryLength);
            }
          }

          this.connection.symbols = symbols;
          return symbols;
        })
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  getDataTypes = () => new Promise<DataTypesList>(async (resolve, reject) => {
    try {
      debug.ads(`Read datatypes`);
      const { dataTypeLength } = await this.getUploadInfo();

      this.read(ads.ADSIGRP.SYM_DT_UPLOAD, 0, dataTypeLength)
        .then(dataTypeData => {
          const dataTypes:DataTypesList = {};
          let _buffer = dataTypeData.data;

          while (_buffer.length >= 40) {
            const entryLength = _buffer.readUInt32LE(0);
            if (_buffer.length >= entryLength && entryLength >= 40) {
              const entryData = _buffer.slice(4, entryLength);
              const item = this.decodeDataType(entryData);
              dataTypes[item.name] = item;
              _buffer = _buffer.slice(entryLength);
            }
          }

          this.connection.dataTypes = dataTypes;
          return dataTypes;
        })
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  getDeviceInfo = () => new Promise<DeviceInfo>((resolve, reject) => {
    try {
      debug.ads(`Read device info`);

      this.request(Command.ReadDeviceInfo, Buffer.alloc(0))
        .then(resp => ({
          majorVersion: resp.data.readUInt8(0),
          minorVersion: resp.data.readUInt8(1),
          buildVersion: resp.data.readUInt16LE(2),
          deviceName: resp.data.toString('latin1', 4, 18)
        }))
        .then(resp => {
          this.connection.deviceInfo = resp;
          return resp;
        })
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })
  getDeviceState = () => new Promise<DeviceState>((resolve, reject) => {
    try {
      debug.ads(`Read device state`);

      this.request(Command.ReadState, Buffer.alloc(0))
        .then(resp => ({
          adsState: resp.data.readUInt16LE(0),
          deviceState: resp.data.readUInt16LE(2),
        }))
        .then(resp => {
          this.connection.deviceState = resp;
          return resp;
        })
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  })

  private connectHandler = async () => {
    if (!this._socket) {
      return;
    }

    const { port, address } = <net.AddressInfo>this._socket.address();
    if (!this.options.source.netID) {
      this.options.source.netID = `${address}.1.1`;
    }

    (this.options.target.netID || '') // AMSNetID Target
      .split('.')
      .forEach((c,offset) => {
        this._commandHeader.writeUInt8(parseInt(c, 10),offset);
      });
    this._commandHeader.writeUInt16LE(this.options.target.amsPort, 6); // AMSPort Target
    (this.options.source.netID || '') // AMSNetID Source
      .split('.')
      .forEach((c,offset) => {
        this._commandHeader.writeUInt8(parseInt(c, 10),offset+8);
      });
    this._commandHeader.writeUInt16LE(this.options.source.amsPort || 800, 14); // AMSPort Source

    debug.connection('connected to',this.options.target.host,this.options.target.port,'from', address, port);
    this._emitter.emit('connect');
  }
  private dataHandler = async (data: Buffer) => {
    if (this._buffer === null) {
      this._buffer = data
    } else {
      this._buffer = Buffer.concat([this._buffer, data])
    }
    debug.connection('receive: ', this._buffer, this._buffer.length);

    const {
      _buffer,
      packets,
    } = ams.parse(this._buffer);

    this._buffer = _buffer;
    debug.connection('buffer: ', this._buffer, this._buffer.length);

    (packets || []).forEach(packet => {
      if (this._requests[packet.header.invokeId]) {
        debug.connection('resolve invokeID', packet.header.invokeId);
        this._requests[packet.header.invokeId]({
          header: packet.header,
          data: packet.data || Buffer.alloc(0),
        });
        delete this._requests[packet.header.invokeId];
      }

      switch(packet.type) {
        case ads.types.DeviceNotificationResponse:
          this.notificationHandler(packet);
          break;
      }
    });
  }
  private notificationHandler = (packet: Packet): void => {
    const { data } = packet;

    if (!data) {
      throw new Error('notificationHandler: no data was supplied');
    }

    const stamps = data.readUInt32LE(0);
    let _buffer = data.slice(4);
    for (let stampNumber=0; stampNumber < stamps; stampNumber++) {
      const timestampLow = _buffer.readUInt32LE(0);
      const timestampHigh = _buffer.readUInt32LE(4);
      const samples = _buffer.readUInt32LE(8);
      _buffer = _buffer.slice(12);

      for (let sampleNumber=0; sampleNumber < samples; sampleNumber++) {
        const handle = _buffer.readUInt32LE(0);
        const size = _buffer.readUInt32LE(4);
        const sample = _buffer.slice(8, 8 + size);

        const notificationHandle = Object.values(this.connection.notifications).find(nh => nh.handle === handle);
        if (notificationHandle) {
          this.findTag(notificationHandle.tagName).then(tag => {
            const targetTag = tag.targetTag && tag.targetTag
              .substring(tag.name.length, tag.targetTag.length)
              .split('.')
              .filter(Boolean);
            const parsed = this.parse(tag, sample, targetTag || undefined);
            const timestamp = FileTime.toDate(timestampLow,timestampHigh);
            notificationHandle.callbacks.forEach(callback => callback(parsed, timestamp));
          });
        }

        _buffer = _buffer.slice(8 + size);
      };
    };
  }
  private timeoutHandler = () => {
    debug.connection('timeouted');
    this._emitter.emit('timeout');
    this.close();
  }
  private errorHandler = async (err: Error) => {
    debug.connection('errored', err);
    this._emitter.emit('error', err);
  }
  private closeHandler = async () => {
    debug.connection('closed');
    this._emitter.emit('close');
    this.connection = {
      connected: false,
      deviceInfo: null,
      deviceState: null,
      uploadInfo: null,
      symbols: null,
      dataTypes: null,
      notifications: {},
    };
  }

  private decodeDataType = (entryData: Buffer): DataType => {
    const nameLength = entryData.readUInt16LE(28);
    const typeLength = entryData.readUInt16LE(30);
    const commentLength = entryData.readUInt16LE(32);
    const arrayDimentionsSize = entryData.readUInt16LE(34) * 8;

    const nameOffset = 38;
    const typeOffset = nameOffset + nameLength + 1;
    const commentOffset = typeOffset + typeLength + 1;
    const arrayDimentionsOffset = commentOffset + commentLength + 1;
    const subItemsOffset = arrayDimentionsOffset + arrayDimentionsSize;

    const arrayData = entryData.slice(
      arrayDimentionsOffset,
      arrayDimentionsOffset + arrayDimentionsSize
    );

    let subItemsData = entryData.slice(subItemsOffset);

    const arrayDimentions = [];
    for (let i = 0; i < arrayData.length / 8; i++) {
			//console.log('array loop', i, i*8);
      arrayDimentions.push({
        start: arrayData.readUInt32LE(i * 8),
        length: arrayData.readUInt32LE(i * 8 + 4),
      });
    }

    const subItems = [];
    while(subItemsData.length > 0) {
      const length = subItemsData.readUInt32LE(0);
      if (!length) {
        throw new Error('decodeDataType: sub item length cannot be 0');
      }

      const item = this.decodeDataType(subItemsData.slice(4, length));
      subItems.push(item);
      subItemsData = subItemsData.slice(length);
    }

    return {
      version: entryData.readUInt32LE(0),
      hashValue: entryData.readUInt32LE(4),
      typHashValue: entryData.readUInt32LE(8),
      size: entryData.readUInt32LE(12),
      offset: entryData.readUInt32LE(16),
      dataType: entryData.readUInt32LE(20),
      flags: entryData.readUInt32LE(24),

      subItemsCount: entryData.readUInt16LE(36),

      name: entryData.toString('ascii', nameOffset, nameOffset + nameLength),
      type: entryData.toString('ascii', typeOffset, typeOffset + typeLength),
      comment: entryData.toString('ascii', commentOffset, commentOffset + commentLength),

      arrayDimentions,
      subItems,
    };
  }

  private parse = (tag: SymbolData | DataType, data: Buffer, providedTargetTag?: Array<string>|undefined): any => {
    const type = tag.type.replace(' (VAR_IN_OUT)','');

    const symbolTag = tag as SymbolData;
    const targetTag = providedTargetTag || (
      symbolTag && symbolTag.targetTag && symbolTag.targetTag
        .substring(tag.name.length, symbolTag.targetTag.length)
        .split('.')
        .filter(Boolean)
    ) || undefined;

    switch(type) {
      case 'BOOL':
      case 'BIT':
        return data.readUInt8(0) > 0;
      case 'BYTE':  // 1byte UINT
      case 'USINT': // 1byte UINT
      case 'UINT8': // 1byte UINT
        return data.readUInt8(0);
      case 'SINT':  // 1byte INT
      case 'INT8':  // 1byte INT
        return data.readInt8(0);
      case 'UINT':  // 2byte UINT
      case 'WORD':  // 2byte UINT
      case 'UINT16':// 2byte UINT
        return data.readUInt16LE(0);
      case 'INT':   // 2byte INT
      case 'INT16': // 2byte INT
        return data.readInt16LE(0);
      case 'DWORD': // 4byte UINT
      case 'UDINT': // 4byte UINT
      case 'UINT32':// 4byte UINT
        return data.readUInt32LE(0);
      case 'DINT':  // 4byte INT
      case 'INT32': // 4byte INT
        return data.readInt32LE(0);
      case 'REAL':  // 4byte REAL
        return data.readFloatLE(0);
      case 'ULINT': // 8byte UINT
        return data.readBigUInt64LE(0);
      case 'LINT':  // 8byte INT
        return data.readBigInt64LE(0);
      case 'LREAL': // 8byte REAL
        return data.readDoubleLE(0);

      case 'DATE':  // 4byte
      case 'DT':    // 4byte
      case 'DATE_AND_TIME':    // 4byte
        // timestamp stored in seconds
        return new Date(data.readUInt32LE(0)*1000);

      case 'TIME':  // 4byte
      case 'TOD':   // 4byte
      case 'TIME_OF_DAY':   // 4byte
        // timestamp stored in milliseconds
        const time = new Date(data.readUInt32LE(0));

        return ("0" + time.getHours()).slice(-2) + ":" + ("0" + time.getMinutes()).slice(-2);

      case 'PVOID': // void pointer,
      case 'OTCID': // 4byte
        return data.readUInt32LE(0);
    }

    if (type.substring(0,6) === 'STRING') {
      const str = data.toString('latin1', 0, tag.size);

			return str.substring(0, str.indexOf('\x00'));
    }

    if (!this.connection.dataTypes) {
      this.getDataTypes();
    }

    const dt = this.connection.dataTypes && this.connection.dataTypes[tag.type];

    if (!dt) {
			return null; // Datatype was not found
    }

    if (dt.arrayDimentions.length > 0) {
      return this.parseArray(dt, data.slice(dt.offset, dt.offset + dt.size), [...dt.arrayDimentions]);
    }

    if (dt.subItems.length > 0) {
      // Special case if the user has requested a tag that is a subItem of a symbol
      if (targetTag && targetTag.length) {
        const subTargetTag = targetTag.shift();
        const item = dt.subItems.find((item) => item.name === subTargetTag);
        if (item) {
          return this.parse(item, data.slice(item.offset, item.offset + item.size), targetTag);
        }
        throw new Error(`parse: could not find subItem "${subTargetTag}" of in datatype "${dt.name}"`);
      }

      return dt.subItems.reduce((acc: {[key: string]: any }, item) => {
        acc[item.name] = this.parse(item, data.slice(item.offset, item.offset + item.size), targetTag);
        return acc;
      }, {});
    }

    return null; // Datatype was of an unknown type, just skip it
  }

  private parseArray = (tag: SymbolData | DataType, data: Buffer, dimentions: Array<ArrayDimention>): any => {
		if (!dimentions) {
			throw new Error('parse: invalid array dimention');
		}

    const { start, length } = dimentions.pop() || { start: 0 };

		if (!length) {
			throw new Error('parse: invalid array dimention');
		}

    let ret:{ [name:string]: any } = {};
		const slice = data.length / length;

    for(let i=0;i<length;i++) {
			if (dimentions.length) {
	      ret[`${i+start}`] = this.parseArray(tag, data.slice(i * slice, (i+1) * slice), dimentions);
			} else {
				//console.log('slice', tag, i, slice);
	      ret[`${i+start}`] = this.parse(tag, data.slice(i * slice, (i+1) * slice));
			}
    }

		//console.log('array', ret);

    return ret;
  }

  private encode = (tag: SymbolData | DataType, value: any, providedTargetTag?: Array<string>|undefined): WriteInformation => {
    const type = tag.type.replace(' (VAR_IN_OUT)','');

    const symbolTag = tag as SymbolData;
    const targetTag = providedTargetTag || (
      symbolTag && symbolTag.targetTag && symbolTag.targetTag
        .substring(tag.name.length, symbolTag.targetTag.length)
        .split('.')
        .filter(Boolean)
    ) || undefined;

    let _buffer = Buffer.alloc(8)
    const resp = {
      group: symbolTag.group,
      offset: tag.offset,
      size: tag.size,
    }
    switch(type) {
      case 'BOOL':
      case 'BIT':
        _buffer.writeUInt8(value ? 1 : 0, 0);
        _buffer = _buffer.slice(0,1);
        return { ...resp, data: _buffer };
      case 'BYTE':  // 1byte UINT
      case 'USINT': // 1byte UINT
      case 'UINT8': // 1byte UINT
        _buffer.writeUInt8(value, 0);
        _buffer = _buffer.slice(0,1);
        return { ...resp, data: _buffer };
      case 'SINT':  // 1byte INT
      case 'INT8':  // 1byte INT
        _buffer.writeInt8(value, 0);
        _buffer = _buffer.slice(0,1);
        return { ...resp, data: _buffer };
      case 'UINT':  // 2byte UINT
      case 'WORD':  // 2byte UINT
      case 'UINT16':// 2byte UINT
        _buffer.writeUInt16LE(value, 0);
        _buffer = _buffer.slice(0,2);
        return { ...resp, data: _buffer };
      case 'INT':   // 2byte INT
      case 'INT16': // 2byte INT
        _buffer.writeInt16LE(value, 0);
        _buffer = _buffer.slice(0,2);
        return { ...resp, data: _buffer };
      case 'DWORD': // 4byte UINT
      case 'UDINT': // 4byte UINT
      case 'UINT32':// 4byte UINT
        _buffer.writeUInt32LE(value, 0);
        _buffer = _buffer.slice(0,4);
        return { ...resp, data: _buffer };
      case 'DINT':  // 4byte INT
      case 'INT32': // 4byte INT
        _buffer.writeInt32LE(value, 0);
        _buffer = _buffer.slice(0,4);
        return { ...resp, data: _buffer };
      case 'REAL':  // 4byte REAL
        _buffer.writeFloatLE(value, 0);
        _buffer = _buffer.slice(0,4);
        return { ...resp, data: _buffer };
      case 'ULINT': // 8byte UINT
        _buffer.writeBigUInt64LE(value, 0);
        _buffer = _buffer.slice(0,8);
        return { ...resp, data: _buffer };
      case 'LINT':  // 8byte INT
        _buffer.writeBigInt64LE(value, 0);
        _buffer = _buffer.slice(0,8);
        return { ...resp, data: _buffer };
      case 'LREAL': // 8byte REAL
        _buffer.writeDoubleLE(value, 0);
        _buffer = _buffer.slice(0,8);
        return { ...resp, data: _buffer };

      case 'DATE':  // 4byte
      case 'DT':    // 4byte
      case 'DATE_AND_TIME':    // 4byte
        // timestamp stored in seconds
        _buffer.writeUInt32LE(+new Date(value)/1000, 0);
        _buffer = _buffer.slice(0,4);
        return { ...resp, data: _buffer };

      case 'TIME':  // 4byte
      case 'TOD':   // 4byte
      case 'TIME_OF_DAY':   // 4byte
        // timestamp stored in milliseconds
        _buffer.writeUInt32LE(+new Date("1970 "+value), 0);
        _buffer = _buffer.slice(0,4);
        return { ...resp, data: _buffer };

      case 'PVOID': // void pointer,
      case 'OTCID': // 4byte
        throw new Error('encode: writing datatypes PVOID and OTCID is not supported');
    }

    if (type.substring(0,6) === 'STRING') {
      return { ...resp, data: Buffer.from(value, 'latin1') };
    }

    if (!this.connection.dataTypes) {
      this.getDataTypes();
    }

    const dt = this.connection.dataTypes && this.connection.dataTypes[tag.type];

    if (!dt) {
      throw new Error(`encode: datatype ${dt} was not found or recogniced`);
    }

    if (dt.arrayDimentions.length > 0) {
      throw new Error("encode: writing arrays are not supported yet");
      //return this.parseArray(dt, data.slice(dt.offset, dt.offset + dt.size), [...dt.arrayDimentions]);
    }

    if (dt.subItems.length > 0) {
      // Special case if the user has requested a tag that is a subItem of a symbol
      if (targetTag && targetTag.length) {
        const subTargetTag = targetTag.shift();
        const item = dt.subItems.find((item) => item.name === subTargetTag);
        if (item) {
          const encoded = this.encode(item, value, targetTag);
          encoded.offset += tag.offset;
          return encoded;
        }
        throw new Error(`encode: could not find subItem "${subTargetTag}" of in datatype "${dt.name}"`);
      }

      const buffer = Buffer.alloc(dt.size);
      dt.subItems.forEach(item => {
        if (typeof value[item.name] === 'undefined') {
          throw new Error(`encode: cant write structure if not all values are defined, ${item.name} is missing in ${dt.name} (${tag.name})`);
        }
        const encoded = this.encode(item, value[item.name], targetTag);
        encoded.offset += tag.offset;
        encoded.data.copy(buffer, item.offset);
      });
      return {
        offset: tag.offset,
        size: tag.size,
        data: buffer,
      }
    }

    throw new Error(`encode: datatype ${dt} was not recogniced`);
  }
};
