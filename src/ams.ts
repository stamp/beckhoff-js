import Debug from 'debug';
import { Types } from './ads';

export interface Header {
  targetId: Buffer,
  targetPort: number,
  sourceId: Buffer,
  sourcePort: number,
  commandId: Types,
  stateFlags: number,
  length: number,
  errorCode: number,
  invokeId: number,
}

export interface Packet {
  type: Types,
  header: Header,
  result?: number,
  length?: number,
  data?: Buffer,
}
export interface Response {
  header: Header;
  data: Buffer;
}

const debug = Debug('beckhoff-js:ams');

const tcpHeaderPadding = 2;
const tcpHeaderSize = tcpHeaderPadding + 4;
const amsHeaderSize = 32;
const headerSize = tcpHeaderSize + amsHeaderSize;

export function decode (_buffer: Buffer): Packet | void {
  const commandId = _buffer.readUInt16LE(16);

  const header = {
    targetId: _buffer.slice(0,6),
    targetPort: _buffer.readUInt16LE(6),
    sourceId: _buffer.slice(8,14),
    sourcePort: _buffer.readUInt16LE(14),
    commandId,
    stateFlags: _buffer.readUInt16LE(18),
    length: _buffer.readUInt32LE(20),
    errorCode: _buffer.readUInt32LE(24),
    invokeId: _buffer.readUInt32LE(28),
  };

  if (_buffer.length < header.length) {
    throw new Error(`decode: data length is to short, expected ${header.length} but got ${_buffer.length}`);
  }

  switch(header.commandId) {
  case Types.ReadDeviceInfoResponse:
    return {
      type: header.commandId,
      header,
      result: _buffer.readUInt32LE(32),
      data: _buffer.slice(36),
    };
  case Types.ReadResponse:
    return {
      type: header.commandId,
      header,
      result: _buffer.readUInt32LE(32),
      length: _buffer.readUInt32LE(36),
      data: _buffer.slice(40),
    };
  case Types.WriteResponse:
    return {
      type: header.commandId,
      header,
      result: _buffer.readUInt32LE(32),
    };
  case Types.ReadStateResponse:
    return {
      type: header.commandId,
      header,
      result: _buffer.readUInt32LE(32),
      data: _buffer.slice(36),
    };
  case Types.WriteControlResponse:
    return {
      type: header.commandId,
      header,
      result: _buffer.readUInt32LE(32),
    };
  case Types.AddDeviceNotificationResponse:
    return {
      type: header.commandId,
      header,
      result: _buffer.readUInt32LE(32),
      data: _buffer.slice(36),
    };
  case Types.DeleteDeviceNotificationResponse:
    return {
      type: header.commandId,
      header,
      result: _buffer.readUInt32LE(32),
    };
  case Types.DeviceNotificationResponse:
    return {
      type: header.commandId,
      header,
      length: _buffer.readUInt32LE(32),
      data: _buffer.slice(36),
    };
  case Types.ReadWriteResponse:
    return {
      type: header.commandId,
      header,
      result: _buffer.readUInt32LE(32),
      length: _buffer.readUInt32LE(36),
      data: _buffer.slice(40),
    };
  default:
    throw new Error(`decode: data invalid commandId received ${header.commandId}`);
  }
};

export function parse (_buffer: Buffer): {buffer: Buffer, packets: Packet[]} {
  const packets:Packet[] = [];
  let buffer = _buffer;
  let packet = null;
  do {
    packet = null;
    const tcpLength = buffer.readUInt32LE(2);
    if (buffer.length >= tcpHeaderSize + tcpLength && tcpLength >= 32) {
      const tcpPacket = buffer.slice(tcpHeaderSize, tcpHeaderSize + tcpLength);
      packet = decode(tcpPacket);
      debug('recived tcpPacket', packet);
      if (packet) {
        packets.push(packet);
      }
      buffer = buffer.slice(tcpLength + tcpHeaderSize);
    }
  } while (buffer.length >= headerSize && packet);

  return { buffer, packets };
};
