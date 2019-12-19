import Debug from 'debug';
import { Header } from './ams';

const debug = Debug('beckhoff-js:ads');

export enum Command {
  ReadDeviceInfo = 0x0001,
  Read = 0x0002,
  Write = 0x0003,
  ReadState = 0x0004,
  WriteControl = 0x0005,
  AddDeviceNotification = 0x0006,
  DeleteDeviceNotification = 0x0007,
  DeviceNotification = 0x0008,
  ReadWrite = 0x0009,
}

export enum Types {
  ReadDeviceInfoResponse = 0x0001,
  ReadResponse = 0x0002,
  WriteResponse = 0x0003,
  ReadStateResponse = 0x0004,
  WriteControlResponse = 0x0005,
  AddDeviceNotificationResponse = 0x0006,
  DeleteDeviceNotificationResponse = 0x0007,
  DeviceNotificationResponse = 0x0008,
  ReadWriteResponse = 0x0009,
}

export enum TransmissionModes {
  NoTransmission = 0,
  ClientCycle = 1,
  ClientOnChange = 2,
  ServerCycle = 3,
  ServerOnChange = 4,
  ServerCycle2 = 5,
  ServerOnChange2 = 6,
  Client1Req = 10,
}

export enum AdsState {
  Invalid = 0,
  Idle = 1,
  Reset = 2,
  Init = 3,
  Start = 4,
  Run = 5,
  Stop = 6,
  SaveConfig = 7,
  LoadConfig = 8,
  PowerFailure = 9,
  PowerGood = 10,
  Error = 11,
  Shutdown = 12,
  Suspend = 13,
  Resume = 14,
  Config = 15,
  ReConfig = 16,
  Stopping = 17,
  Incompatible = 18,
  Exception = 19,
}

export interface Response {
  header: Header;
  data: Buffer;
}

// credits to https://github.com/roccomuso/node-ads/blob/master/lib/ads.js
export const Errors: { [key: number]: string } = {
  0: 'OK',
  1: 'Internal error',
  2: 'No Rtime',
  3: 'Allocation locked memory error',
  4: 'Insert mailbox error',
  5: 'Wrong receive HMSG',
  6: 'target port not found',
  7: 'target machine not found',
  8: 'Unknown command ID',
  9: 'Bad task ID',
  10: 'No IO',
  11: 'Unknown AMS command',
  12: 'Win 32 error',
  13: 'Port not connected',
  14: 'Invalid AMS length',
  15: 'Invalid AMS Net ID',
  16: 'Low Installation level',
  17: 'No debug available',
  18: 'Port disabled',
  19: 'Port already connected',
  20: 'AMS Sync Win32 error',
  21: 'AMS Sync Timeout',
  22: 'AMS Sync AMS error',
  23: 'AMS Sync no index map',
  24: 'Invalid AMS port',
  25: 'No memory',
  26: 'TCP send error',
  27: 'Host unreachable',
  1792: 'error class <device error>',
  1793: 'Service is not supported by server',
  1794: 'invalid index group',
  1795: 'invalid index offset',
  1796: 'reading/writing not permitted',
  1797: 'parameter size not correct',
  1798: 'invalid parameter value(s)',
  1799: 'device is not in a ready state',
  1800: 'device is busy',
  1801: 'invalid context (must be in Windows)',
  1802: 'out of memory',
  1803: 'invalid parameter value(s)',
  1804: 'not found (files, ...)',
  1805: 'syntax error in command or file',
  1806: 'objects do not match',
  1807: 'object already exists',
  1808: 'symbol not found',
  1809: 'symbol version invalid',
  1810: 'server is in invalid state',
  1811: 'AdsTransMode not supported',
  1812: 'Notification handle is invalid',
  1813: 'Notification client not registered',
  1814: 'no more notification handles',
  1815: 'size for watch too big',
  1816: 'device not initialized',
  1817: 'device has a timeout',
  1818: 'query interface failed',
  1819: 'wrong interface required',
  1820: 'class ID is invalid',
  1821: 'object ID is invalid',
  1822: 'request is pending',
  1823: 'request is aborted',
  1824: 'signal warning',
  1825: 'invalid array index',
  1826: 'symbol not active -> release handle and try again',
  1827: 'access denied',
  1856: 'Error class <client error>',
  1857: 'invalid parameter at service',
  1858: 'polling list is empty',
  1859: 'var connection already in use',
  1860: 'invoke ID in use',
  1861: 'timeout elapsed',
  1862: 'error in win32 subsystem',
  1863: 'Invalid client timeout value',
  1864: 'ads-port not opened',
  1872: 'internal error in ads sync',
  1873: 'hash table overflow',
  1874: 'key not found in hash',
  1875: 'no more symbols in cache',
  1876: 'invalid response received',
  1877: 'sync port is locked',
}

// credits to https://github.com/roccomuso/node-ads/blob/master/lib/ads.js
export enum State {
  INVALID=      0,
  IDLE=         1,
  RESET=        2,
  INIT=         3,
  START=        4,
  RUN=          5,
  STOP=         6,
  SAVECFG=      7,
  LOADCFG=      8,
  POWERFAILURE= 9,
  POWERGOOD=    10,
  ERROR=        11,
  SHUTDOWN=     12,
  SUSPEND=      13,
  RESUME=       14,
  CONFIG=       15,
  RECONFIG=     16,
  STOPPING=     17,
}

// credits to https://github.com/roccomuso/node-ads/blob/master/lib/ads.js
// credits to https://github.com/tomcx/tame4/blob/master/tame.js
export enum ADSIGRP {
  M=                    0x4020, //PLC memory range(%M field), READ_M - WRITE_M
  MX=                   0x4021, //PLC memory range(%MX field), READ_MX - WRITE_MX
  DB=                   0x4040, //Data range
  I=                    0xF020, //PLC process diagram of the physical inputs(%I field), READ_I - WRITE_I
  IX=                   0xF021, //PLC process diagram of the physical inputs(%IX field), READ_IX - WRITE_IX
  Q=                    0xF030, //PLC process diagram of the physical outputs(%Q field), READ_Q - WRITE_Q
  QX=                   0xF031, //PLC process diagram of the physical outputs(%QX field), READ_QX - WRITE_QX

  SYMTAB=               0xF000,
  SYMNAME=              0xF001,
  SYMVAL=               0xF002,
  GET_SYMHANDLE_BYNAME= 0xF003, // {TcAdsDef.h: ADSIGRP_SYM_HNDBYNAME}
  READ_SYMVAL_BYNAME=   0xF004, // {TcAdsDef.h: ADSIGRP_SYM_VALBYNAME} (Value by name)
  RW_SYMVAL_BYHANDLE=   0xF005, // {TcAdsDef.h: ADSIGRP_SYM_VALBYHND} (Value by handle)
  RELEASE_SYMHANDLE=    0xF006, // {TcAdsDef.h: ADSIGRP_SYM_RELEASEHND} (Release handle)
  SYM_INFOBYNAME=       0xF007,
  SYM_VERSION=          0xF008,
  SYM_INFOBYNAMEEX=     0xF009,
  SYM_DOWNLOAD=         0xF00A,
  SYM_UPLOAD=           0xF00B,
  SYM_UPLOADINFO=       0xF00C,
  SYM_DOWNLOAD2=        0xF00D,
  SYM_DT_UPLOAD=        0xF00E,
  SYM_UPLOADINFO2=      0xF00F,
  SYMNOTE=              0xF010,    // notification of named handle
  SUMUP_READ=           0xF080,    // AdsRW  IOffs list size or 0 (=0 -> list size == WLength/3*sizeof(ULONG))
                      // W: {list of IGrp, IOffs, Length}
                      // if IOffs != 0 then R: {list of results} and {list of data}
                      // if IOffs == 0 then R: only data (sum result)
  SUMUP_WRITE=          0xF081,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, Length} followed by {list of data}
                      // R: list of results
  SUMUP_READWRITE=      0xF082,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, RLength, WLength} followed by {list of data}
                      // R: {list of results, RLength} followed by {list of data}
  SUMUP_READEX=         0xF083,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, Length}
  SUMUP_READEX2=        0xF084,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, Length}
                      // R: {list of results, Length} followed by {list of data (returned lengths)}
  SUMUP_ADDDEVNOTE=     0xF085,    // AdsRW  IOffs list size
                      // W: {list of IGrp, IOffs, Attrib}
                      // R: {list of results, handles}
  SUMUP_DELDEVNOTE=     0xF086,    // AdsRW  IOffs list size
                      // W: {list of handles}
                      // R: {list of results, Length} followed by {list of data}
  IOIMAGE_RWIB=         0xF020,    // read/write input byte(s)
  IOIMAGE_RWIX=         0xF021,    // read/write input bit
  IOIMAGE_RISIZE=       0xF025,    // read input size (in byte)
  IOIMAGE_RWOB=         0xF030,    // read/write output byte(s)
  IOIMAGE_RWOX=         0xF031,    // read/write output bit
  IOIMAGE_CLEARI=       0xF040,    // write inputs to null
  IOIMAGE_CLEARO=       0xF050,    // write outputs to null
  IOIMAGE_RWIOB=        0xF060,    // read input and write output byte(s)
  DEVICE_DATA=          0xF100,    // state, name, etc...
}

export enum IndexGroup {

};

export default {
  types: Types,
  errors: Errors,
  state: State,
  ADSIGRP,
};
