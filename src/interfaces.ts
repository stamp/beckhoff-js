import { ADSNotifyTransmissionMode } from './ads';

export interface Options extends ConnectOptions, ClientOptions {}

export interface ConnectOptions {
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
  reconnect?: boolean;
  reconnectInterval?: number;
}

export interface ClientOptions {
  loadSymbols?: boolean;
  loadDataTypes?: boolean;
}

export interface DeviceInfo {
  majorVersion: number;
  minorVersion: number;
  buildVersion: number;
  deviceName: string;
}
export interface DeviceState {
  adsState: number;
  deviceState: number;
}
export interface UploadInfo {
  symbolCount: number;
  symbolLength: number;
  dataTypeCount: number;
  dataTypeLength: number;
  extraCount: number;
  extraLength: number;
}
export interface NotificationHandle {
  handle: number,
  tagName: string,
  callbacks: ((value:any, timestamp: number) => void)[];
}
export interface ConnectionInfo {
  // Upload information
  uploadInfo: UploadInfo | null;
  uploadInfoTimestamp?: number;
  symbols: SymbolsList | null,
  dataTypes: DataTypesList | null,
  notifications: { [name: string]: NotificationHandle },
}
export interface SymbolsList { [name: string]: SymbolData };
export interface DataTypesList { [typeId: string]: DataType }
export interface SymbolData {
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

export interface FindTag {
  group: number,
  offset: number,
  size: number,
  type: string,
  dataType: number,
}

export interface ArrayDimention {
  start: number,
  length: number,
}
export interface DataType {
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

  arrayDimensions: ArrayDimention[],
  subItems: DataType[],
}
export interface WriteInformation {
  offset: number,
  size: number,
  data: Buffer,
}

export interface NotifyOptions {
  transmissionMode?: ADSNotifyTransmissionMode,
  maxDelay?: number,
  cycleTime?: number
}
