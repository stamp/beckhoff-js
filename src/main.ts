import Debug from 'debug';
import { EventEmitter } from 'events';
import FileTime from 'win32filetime';

import {
  DeviceInfo,
  DeviceState,
  UploadInfo,
  FindTag,
  ConnectionInfo,
  SymbolsList,
  DataTypesList,
  DataType,
  Options,
  ClientOptions,
  NotifyOptions
} from './interfaces';
import { ADSConnection, ADSNotifyTransmissionMode, ADSDataTypes, ADSIGRP, Command, Response } from './connection';

export default class Client extends EventEmitter {
  private readonly logger = Debug('beckhoff-js:ads');

  private connection: ADSConnection;

  private options: ClientOptions;

  private connectionInfo: ConnectionInfo = {
    connected: false,
    uploadInfo: null,
    symbols: null,
    dataTypes: null,
    notifications: {},
  };

  constructor(options: Options) {
    super();
    const { loadSymbols, loadDataTypes, ...connectionOptions } = options;
    this.options = {
      loadSymbols: typeof loadSymbols === 'boolean' ? loadSymbols : true,
      loadDataTypes: typeof loadDataTypes === 'boolean' ? loadSymbols : true,
    };
    this.connection = new ADSConnection(connectionOptions);
  }

  public async connect() {
    if (this.connectionInfo.connected) {
      throw new Error('Already Connected');
    }
    // @TODO: if starts with failures...?
    this.connection.removeAllListeners();
    this.connection.connect();
    this.connection.on('reconnect', () => this.emit('reconnect'));
    this.connection.on('connected', this.connectHandler.bind(this));
    this.connection.on('close', this.disconnectHandler.bind(this));
    this.connection.on('notification', this.notificationHandler.bind(this));
    this.connection.on('error', (err) => this.emit('error', err));
    await new Promise((resolve, reject) => {
      const handler = (async (err?: Error) => {
        this.connection.removeListener('connected', handler);
        this.connection.removeListener('error', handler);
        try {
          if (err) {
            throw err;
          }
          if (this.options.loadSymbols === true && !this.connectionInfo.symbols) {
            this.connectionInfo.symbols = await this.getSymbols();
          }
          if (this.options.loadDataTypes === true && !this.connectionInfo.dataTypes) {
            this.connectionInfo.dataTypes = await this.getDataTypes();
          }
          return resolve();
        } catch (error) {
          this.connection.removeAllListeners();
          this.connection.close();
          return reject(error);
        }
      });
      this.connection.once('connected', handler);
      this.connection.once('error', handler);
    });
  }

  public async read (group: number, offset: number, size: number): Promise<Response> {
    this.logger(`ADS read: ${group}, ${offset}, ${size}`);
    const data = Buffer.allocUnsafe(12);
    data.writeUInt32LE(group, 0);
    data.writeUInt32LE(offset, 4);
    data.writeUInt32LE(size, 8);
    return this.connection.request(Command.Read, data);
  }

  public async write (group: number, offset: number, size: number, value: Buffer): Promise<Response> {
    if (value.length !== size) {
      throw new Error(`expected write size (${size} bytes) and provided data (${value.length} bytes) differs in length`);
    }
    this.logger(`ADS write: ${group}, ${offset}, ${size}`);
    const data = Buffer.allocUnsafe(12 + size);
    data.writeUInt32LE(group, 0);
    data.writeUInt32LE(offset, 4);
    data.writeUInt32LE(size, 8);
    value.copy(data, 12);
    return this.connection.request(Command.Write, data);
  }

  public async getSymbols(): Promise<SymbolsList> {
    const { symbolLength } = await this.getUploadInfo();
    this.logger('ADS SYM_UPLOAD: Read symbols');
    const symbolData = await this.read(ADSIGRP.SYM_UPLOAD, 0, symbolLength);
    const symbols: SymbolsList = {};
    let buffer = symbolData.data;
    while (buffer.length >= 26) {
      const entryLength = buffer.readUInt32LE(0);
      if ((buffer.length >= entryLength && entryLength >= 26)) {
        const entryData = buffer.slice(4, entryLength);
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
        buffer = buffer.slice(entryLength);
      }
    }
    return symbols;
  }

  public async getDataTypes(): Promise<DataTypesList> {
    this.logger('ADS SYM_DT_UPLOAD: Read datatypes');
    const { dataTypeLength } = await this.getUploadInfo();
    const dataTypeData = await this.read(ADSIGRP.SYM_DT_UPLOAD, 0, dataTypeLength);
    const dataTypes:DataTypesList = {};
    let buffer = dataTypeData.data;
    while (buffer.length >= 40) {
      const entryLength = buffer.readUInt32LE(0);
      if (buffer.length >= entryLength && entryLength >= 40) {
        const entryData = buffer.slice(4, entryLength);
        const item = this.decodeDataType(entryData);
        dataTypes[item.name] = item;
        buffer = buffer.slice(entryLength);
      }
    }
    return dataTypes;
  }

  public async getDeviceState(): Promise<DeviceState> {
    this.logger('Read device state');
    const resp = await this.connection.request(Command.ReadState, Buffer.alloc(0));
    return {
      adsState: resp.data.readUInt16LE(0),
      deviceState: resp.data.readUInt16LE(2),
    };
  }

  public async getDeviceInfo(): Promise<DeviceInfo> {
    this.logger('get Device info');
    const resp = await this.connection.request(Command.ReadDeviceInfo, Buffer.alloc(0));
    return {
      majorVersion: resp.data.readUInt8(0),
      minorVersion: resp.data.readUInt8(1),
      buildVersion: resp.data.readUInt16LE(2),
      deviceName: resp.data.toString('latin1', 4, 18)
    };
  }

  public async readTag (tagName: string): Promise<any> {
    this.logger(`Read Tag ${tagName}`);
    const tag = await this.findTag(tagName);
    return this.read(tag.group, tag.offset, tag.size)
      .then(resp => this.parseData(tag, resp.data));
  }

  public async writeTag (tagName: string, value: any): Promise<Response> {
    this.logger(`Write Tag ${tagName} value ${value}`);
    const tag = await this.findTag(tagName);
    const encoded = this.encodeData(tag, value);
    return this.write(tag.group, tag.offset, tag.size, encoded);
  }

  public async monitorTag (tagName: string, callback: (value: any) => void): Promise<number> {
    this.logger(`Monitor Tag ${tagName}`);
    const tag = await this.findTag(tagName);
    if (this.connectionInfo.notifications[tagName]) {
      this.connectionInfo.notifications[tagName].callbacks.push(callback);
      return Promise.resolve(this.connectionInfo.notifications[tagName].handle);
    }
    const notificationHandle = {
      handle: -1,
      tagName,
      callbacks: [callback]
    };
    // IDEA: const notifyOptions: notifyOptions = {}
    this.connectionInfo.notifications[tagName] = notificationHandle;
    return this.subscribe(tag.group, tag.offset, tag.size)
      .then(resp => {
        this.connectionInfo.notifications[tagName].handle = resp.data.readUInt32LE(0);
        return this.connectionInfo.notifications[tagName].handle;
      });
  }

  public async stopMonitorTag(tagName: string, callback: (value: any) => void | undefined): Promise<void> {
    this.logger(`stopMonitor Tag ${tagName}`);
    const notificationHandle = this.connectionInfo.notifications[tagName];
    if (!notificationHandle) {
      throw new Error('Monitoring tag not found');
    }
    const cbIndex = notificationHandle.callbacks.indexOf(callback);
    if (cbIndex < 0) {
      throw new Error('Monitoring tag callback not found');
    }
    notificationHandle.callbacks.splice(cbIndex, 1);
    if (notificationHandle.callbacks.length > 0) {
      return Promise.resolve();
    }
    return this.unsubscribe(notificationHandle.handle)
      .then(() => {
        delete this.connectionInfo.notifications[tagName];
      });
  }

  public async close() {
    await Promise.all(Object.values(this.connectionInfo.notifications).map(
      notificationHandle => this.unsubscribe(notificationHandle.handle)
    ));
    this.connection.removeAllListeners();
    this.connection.close();
  }

  public async findTag(tagName: string): Promise<FindTag> {
    if (!this.connectionInfo.symbols) {
      this.connectionInfo.symbols = await this.getSymbols();
    }
    if (!this.connectionInfo.dataTypes) {
      this.connectionInfo.dataTypes = await this.getDataTypes();
    }
    const [ programName, symbolName, ...path ] = this.parseTagName(tagName);
    const systemTagName = `${programName.name}.${symbolName.name}`;
    const symbol = Object.values(this.connectionInfo.symbols)
      .find(s => s.systemName === systemTagName);
    if (!symbol) {
      throw new Error(`Symbol not found ${systemTagName} found for tag ${tagName}`);
    }
    const symbolDataType = Object.values(this.connectionInfo.dataTypes)
      .find(s => s.name === symbol.type);
    if (path && path.length > 0 && !symbolDataType) { // if we have a path, then we must have Structure
      throw new Error(`Symbol data type (${symbol.type}) not found for tag ${tagName}`);
    }
    // @TODO: how to parse array path...
    if (symbolDataType && symbolName.arrayDimensions.length > symbolDataType.arrayDimensions.length) {
      throw new Error(`Array has ${symbolDataType.arrayDimensions.length} dimensions`);
    }
    const tag: FindTag = {
      group: symbol.group,
      offset: symbol.offset,
      size: symbol.size,
      type: symbol.type,
      dataType: symbol.dataType,
    };
    let type: DataType | undefined = symbolDataType;
    path.forEach(subitem => {
      const subtype = type && type.subItems.find(s => s.name === subitem.name);
      if (!subtype) {
        throw new Error(`Symbol subItem ${subitem} not found form tag ${systemTagName}`);
      }
      // @TODO: how to parse array path...
      tag.offset += subtype.offset;
      tag.size = subtype.size;
      tag.type = subtype.type;
      tag.dataType = subtype.dataType;
      // we may have next path subItem, may not
      const subitemSubType = Object.values(this.connectionInfo.dataTypes || [])
        .find(s => s.name === subtype.type);
      if (subitemSubType) {
        type = subitemSubType;
      }
    });
    return tag;
  }

  // PROGRAM.VARIABLE.STRUCTUREPARAM.STRUCTURE2PARAM.STRUCTURE3PARAM
  // PROGRAM.VARIABLE[arrayindex]
  // PROGRAM.VARIABLE[arrayindex].STRUCTUREPARAM
  // PROGRAM.VARIABLE[arrayindex].STRUCTUREPARAM[arrayindex].STRUCTUREPARAM
  // .GLOBALVAR
  // @TODO: PROGRAM.VARIABLE[arrayindex][arrayindex]
  private parseTagName(tagName: string): { name: string, arrayDimensions: number[] }[] {
    return tagName
      .split('.')
      .map(part => {
        let name = part.toUpperCase();
        let arrayDimensions: number[] = [];
        const isArray = /(\[\d+\])/ig.exec(part); // TODO: matchAll for multi dimensions
        if (isArray) {
          // arrayDimensions = isArray.map(index => parseInt(index.replace(/\[/, '').replace(/\]/, ''), 10));
          arrayDimensions = [parseInt(isArray[0].replace(/\[/, '').replace(/\]/, ''), 10)];
          [ name ] = part.split('[');
        }
        return { name, arrayDimensions };
      });
  }

  private async connectHandler() {
    this.connectionInfo.connected = true;
    this.emit('connected');
    // (re)subscibe notifications?
  }

  private async disconnectHandler(hadError: boolean) {
    this.connectionInfo.connected = false;
    this.emit('close', hadError);
  }

  private async notificationHandler(packet: Response) {
    const { data } = packet;
    const stamps = data.readUInt32LE(0);
    let buffer = data.slice(4);
    for (let stampNumber=0; stampNumber < stamps; stampNumber+=1) {
      const timestampLow = buffer.readUInt32LE(0);
      const timestampHigh = buffer.readUInt32LE(4);
      const samples = buffer.readUInt32LE(8);
      buffer = buffer.slice(12);
      for (let sampleNumber=0; sampleNumber < samples; sampleNumber+=1) {
        const handle = buffer.readUInt32LE(0);
        const size = buffer.readUInt32LE(4);
        const sample = buffer.slice(8, 8 + size);
        const notificationHandle = Object.values(this.connectionInfo.notifications).find(nh => nh.handle === handle);
        if (!notificationHandle) {
          // eslint-disable-next-line no-continue
          continue;
        }
        this.findTag(notificationHandle.tagName)
          .then(async (tag) => {
            const timestamp = FileTime.toDate(timestampLow,timestampHigh);
            const value = await this.parseData(tag, sample);
            return { value, timestamp };
          })
          .then(({ value, timestamp }) => {
            notificationHandle.callbacks.forEach((cb) => cb(value, timestamp));
          })
          .catch(err => {
            this.emit('error', err);
          });
      }
    }
  }

  private async subscribe(group: number, offset: number, size: number, options?: NotifyOptions): Promise<Response> {
    // At the latest after this time, the ADS Device Notification is called. The unit is 1ms.
    const maxDelay = options && options.maxDelay? options.maxDelay : 10;
    // The ADS server checks if the value changes in this time slice. The unit is 1m
    const cycleTime = options && options.cycleTime? options.cycleTime : 10;
    const TransmissionMode = options && options.transmissionMode?
      options.transmissionMode : ADSNotifyTransmissionMode.OnChange;
    this.logger(`ADS addDeviceNotification: g${group}, o${offset}, s${size}, maxDelay ${maxDelay}, cycleTime ${cycleTime} TransmissionMode ${TransmissionMode}`);
    const data = Buffer.alloc(40);
    data.writeUInt32LE(group, 0);
    data.writeUInt32LE(offset, 4);
    data.writeUInt32LE(size, 8);
    data.writeUInt32LE(TransmissionMode, 12);
    data.writeUInt32LE(maxDelay, 16);
    data.writeUInt32LE(cycleTime, 20);
    return this.connection.request(Command.AddDeviceNotification, data);
  }

  private async unsubscribe(handle: number): Promise<Response> {
    this.logger(`ADS deleteDeviceNotification: handle ${handle}`);
    const data = Buffer.alloc(4);
    data.writeUInt32LE(handle, 0);
    return this.connection.request(Command.DeleteDeviceNotification, data);
  }

  private async getUploadInfo(): Promise<UploadInfo> {
    const { uploadInfoTimestamp, uploadInfo } = this.connectionInfo;
    if (uploadInfo !== null && (!uploadInfoTimestamp || (+new Date) - uploadInfoTimestamp < 10000)) {
      return uploadInfo;
    }
    this.logger('ADS getUploadInfo: Read upload information');
    // Load the upload information from the PLC
    const uploadinfoDevice = await this.read(ADSIGRP.SYM_UPLOADINFO2, 0, 24);
    if (uploadinfoDevice.data.length < 24) {
      throw new Error('getUploadInfo: did not receive the expected 24 bytes');
    }
    const uploadInfoData = {
      symbolCount: uploadinfoDevice.data.readUInt32LE(0),
      symbolLength: uploadinfoDevice.data.readUInt32LE(4),
      dataTypeCount: uploadinfoDevice.data.readUInt32LE(8),
      dataTypeLength: uploadinfoDevice.data.readUInt32LE(12),
      extraCount: uploadinfoDevice.data.readUInt32LE(16),
      extraLength: uploadinfoDevice.data.readUInt32LE(20)
    };
    this.connectionInfo.uploadInfo = uploadInfoData;
    this.connectionInfo.uploadInfoTimestamp = + new Date();
    return uploadInfoData;
  }

  private decodeDataType (entryData: Buffer): DataType {
    const nameLength = entryData.readUInt16LE(28);
    const typeLength = entryData.readUInt16LE(30);
    const commentLength = entryData.readUInt16LE(32);
    const arrayDimensionsSize = entryData.readUInt16LE(34) * 8;
    const nameOffset = 38;
    const typeOffset = nameOffset + nameLength + 1;
    const commentOffset = typeOffset + typeLength + 1;
    const arrayDimensionsOffset = commentOffset + commentLength + 1;
    const subItemsOffset = arrayDimensionsOffset + arrayDimensionsSize;
    const arrayData = entryData.slice(
      arrayDimensionsOffset,
      arrayDimensionsOffset + arrayDimensionsSize
    );
    let subItemsData = entryData.slice(subItemsOffset);
    const arrayDimensions = [];
    for (let i = 0; i < arrayData.length / 8; i+=1) {
      arrayDimensions.push({
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
      arrayDimensions,
      subItems,
    };
  }

  private encodeData(tag: FindTag, value: any): Buffer {
    const buffer = Buffer.alloc(8);
    switch(tag.dataType) {
    case ADSDataTypes.BIT:
      buffer.writeUInt8(value ? 1 : 0, 0);
      return buffer.slice(0,1);
    case ADSDataTypes.INT8:
      buffer.writeInt8(value);
      return buffer.slice(0,1);
    case ADSDataTypes.UINT8:
      buffer.writeUInt8(value);
      return buffer.slice(0,1);
    case ADSDataTypes.INT16:
      buffer.writeInt16LE(value);
      return buffer.slice(0,2);
    case ADSDataTypes.UINT16:
      buffer.writeUInt16LE(value);
      return buffer.slice(0,2);
    case ADSDataTypes.INT32:
      buffer.writeInt32LE(value);
      return buffer.slice(0,4);
    case ADSDataTypes.UINT32:
      buffer.writeUInt32LE(value);
      return buffer.slice(0,4);
    case ADSDataTypes.UINT64:
      buffer.writeBigUInt64LE(value);
      return buffer.slice(0,8);
    case ADSDataTypes.REAL32:
      buffer.writeFloatLE(value);
      return buffer.slice(0,4);
    case ADSDataTypes.REAL64:
      buffer.writeDoubleLE(value);
      return buffer.slice(0,8);
    case ADSDataTypes.REAL80:
      throw new Error('Datatype REAL80 not implemented');
    case ADSDataTypes.VOID: // void pointer
      throw new Error('Datatype VOID cannot be written');
    case ADSDataTypes.STRING:
    case ADSDataTypes.WSTRING:
      return Buffer.from(value, 'latin1');
    case ADSDataTypes.BIGTYPE: // BLOB (eg. Structure / Array / time)
      // eslint-disable-next-line no-case-declarations
      const dt = this.connectionInfo.dataTypes && this.connectionInfo.dataTypes[tag.type];
      if (tag.type === 'DATE' || tag.type === 'DT' || tag.type === 'DATE_AND_TIME') {
        // timestamp stored in seconds
        buffer.writeUInt32LE(+new Date(value)/1000, 0);
        return buffer.slice(0,4);
      } if (tag.type === 'TIME' || tag.type === 'TIME_OF_DAY' || tag.type === 'TOD') {
        // timestamp stored in milliseconds
        buffer.writeUInt32LE(+new Date(`1970 ${value}`), 0);
        return buffer.slice(0,4);
      } if (dt && dt.arrayDimensions.length === 0) { // Existing Structure
        throw new Error('Structure write not implemented');
      } if (dt && dt.arrayDimensions.length > 0) {
        throw new Error('Array write not implemented yet');
      }
      throw new Error(`Datatype ${tag.type} not implemented`);
    default:
      throw new Error(`Datatype ${tag.type} not implemented`);
    }
  }

  private encodeStructure(dataType: DataType, value: any): any {

  }

  private parseData(tag: { dataType: number, size: number, type: string, offset: number }, data: Buffer): any {
    switch(tag.dataType) {
    case ADSDataTypes.BIT:
      return data.readUInt8(0) > 0;
    case ADSDataTypes.INT8:
      return data.readInt8(0);
    case ADSDataTypes.UINT8:
      return data.readUInt8(0);
    case ADSDataTypes.INT16:
      return data.readInt16LE(0);
    case ADSDataTypes.UINT16:
      return data.readUInt16LE(0);
    case ADSDataTypes.INT32:
      return data.readInt32LE(0);
    case ADSDataTypes.UINT32:
      return data.readUInt32LE(0);
    case ADSDataTypes.UINT64:
      return data.readBigUInt64LE(0);
    case ADSDataTypes.REAL32:
      return data.readFloatLE(0);
    case ADSDataTypes.REAL64:
      return data.readDoubleLE(0);
    case ADSDataTypes.REAL80:
      throw new Error('Datatype REAL80 not implemented');
    case ADSDataTypes.VOID: // void pointer
      return data.readUInt32LE(0);
    case ADSDataTypes.STRING:
    case ADSDataTypes.WSTRING:
      // eslint-disable-next-line no-case-declarations
      const str = data.toString('latin1', 0, tag.size);
      return str.substring(0, str.indexOf('\x00'));
    case ADSDataTypes.BIGTYPE: // BLOB (eg. Structure / Array / TIME)
      // eslint-disable-next-line no-case-declarations
      const dt = this.connectionInfo.dataTypes && this.connectionInfo.dataTypes[tag.type];
      if (tag.type === 'DATE' || tag.type === 'DT' || tag.type === 'DATE_AND_TIME') {
        // timestamp stored in seconds
        return new Date(data.readUInt32LE(0) * 1000);
      } if (tag.type === 'TIME' || tag.type === 'TIME_OF_DAY' || tag.type === 'TOD') {
        // timestamp stored in milliseconds
        const time = new Date(data.readUInt32LE(0));
        return `${(`0${time.getHours()}`).slice(-2)}:${(`0${time.getMinutes()}`).slice(-2)}`;
      } if (dt && dt.arrayDimensions.length === 0) { // Existing Structure
        return this.parseStructure(dt, data);
      } if (dt && dt.arrayDimensions.length > 0) {
        return this.parseArray(dt, data.slice(dt.offset, dt.offset + dt.size));
      }
      return data; // return Buffer for unknown BLOB type
    default:
      throw new Error(`Datatype ${tag.type} not implemented`);
    }
  }

  private parseStructure(dataType: DataType, data: Buffer): {[name:string]: any} {
    const ret:{[name:string]: any} = {};
    if (data.length !== dataType.size) {
      throw new Error(`Invaid datatype ${dataType.name}<${dataType.size}> for buffer Buffer<${data.length}>`);
    }
    dataType.subItems.forEach((subitem: DataType) => {
      const tag = {
        size: subitem.size,
        dataType: subitem.dataType,
        type: subitem.type,
        offset: subitem.offset
      };
      if ((subitem.size + subitem.offset) > data.length) {
        throw new Error(`Stucture ${dataType.name} expected buffer size (${subitem.size + subitem.offset} bytes) and provided data ${data.length} bytes`);
      }
      ret[subitem.name] = this.parseData(tag, data.slice(tag.offset, tag.offset+tag.size));
    });
    return ret;
  }

  private parseArray(dataType: DataType, data: Buffer, dimension?: number): any[] {
    const { arrayDimensions } = dataType;
    if (data.length !== dataType.size) {
      throw new Error(`Invaid datatype ${dataType.name}<${dataType.size}> for buffer Buffer<${data.length}>`);
    }
    if (!arrayDimensions) {
      throw new Error('parseArray: invalid array dimention');
    }
    const currentDimension = dimension || (arrayDimensions.length - 1);
    if (!arrayDimensions[currentDimension]) {
      throw new Error('parseArray: invalid array dimention len');
    }
    const { start, length } = arrayDimensions[currentDimension];
    const ret: any[] = new Array(start + length);
    const slice = data.length / length;
    for (let i = 0; i < length; i+=1) {
      ret[i+start] = currentDimension > 0 ?
        this.parseArray(dataType, data.slice(i*slice, (i+1)*slice), (currentDimension-1)) :
        this.parseData(dataType, data.slice(i*slice, (i+1)*slice));
    }
    return ret;
  }

}
