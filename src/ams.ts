import Debug from 'debug';
import ads, { Types } from './ads';

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

const debug = Debug('beckhoff-js:ams');

const tcpHeaderPadding = 2;
const tcpHeaderSize = tcpHeaderPadding + 4;
const amsHeaderSize = 32;
const headerSize = tcpHeaderSize + amsHeaderSize;

export const decode = (_buffer: Buffer): Packet | void => {
  const commandId = _buffer.readUInt16LE(16);

  const header = {
    targetId: _buffer.slice(0,6),
    targetPort: _buffer.readUInt16LE(6),
    sourceId: _buffer.slice(8,14),
    sourcePort: _buffer.readUInt16LE(14),
    commandId: commandId,
    stateFlags: _buffer.readUInt16LE(18),
    length: _buffer.readUInt32LE(20),
    errorCode: _buffer.readUInt32LE(24),
    invokeId: _buffer.readUInt32LE(28),
  };

  if (_buffer.length < header.length) {
    throw new Error(`data length is to short, expected ${header.length} but got ${_buffer.length}`);
  }

  switch(header.commandId) {
    case ads.types.ReadDeviceInfoResponse:
      return {
        type: header.commandId,
        header,
        result: _buffer.readUInt32LE(32),
        data: _buffer.slice(36),
      }
    case ads.types.ReadResponse:
      return {
        type: header.commandId,
        header,
        result: _buffer.readUInt32LE(32),
        length: _buffer.readUInt32LE(36),
        data: _buffer.slice(40),
      }
    case ads.types.WriteResponse:
      return {
        type: header.commandId,
        header,
        result: _buffer.readUInt32LE(32),
      }
    case ads.types.ReadStateResponse:
      return {
        type: header.commandId,
        header,
        result: _buffer.readUInt32LE(32),
        data: _buffer.slice(36),
      }
    case ads.types.WriteControlResponse:
      return {
        type: header.commandId,
        header,
        result: _buffer.readUInt32LE(32),
      }
    case ads.types.AddDeviceNotificationResponse:
      return {
        type: header.commandId,
        header,
        result: _buffer.readUInt32LE(32),
        data: _buffer.slice(36),
      }
    case ads.types.DeleteDeviceNotificationResponse:
      return {
        type: header.commandId,
        header,
        result: _buffer.readUInt32LE(32),
      }
    case ads.types.DeviceNotificationResponse:
      return {
        type: header.commandId,
        header,
        length: _buffer.readUInt32LE(32),
        data: _buffer.slice(36),
      }
    case ads.types.ReadWriteResponse:
      return {
        type: header.commandId,
        header,
        result: _buffer.readUInt32LE(32),
        length: _buffer.readUInt32LE(36),
        data: _buffer.slice(40),
      }
  }
};

export const parse = (_buffer: Buffer): {_buffer: Buffer, packets?: Packet[]} => {
  const packets:Packet[] = [];

  let packet = null;
  do {
    packet = null;
    const tcpLength = _buffer.readUInt32LE(2);
    if (_buffer.length >= tcpHeaderSize + tcpLength && tcpLength >= 32) {
      const tcpPacket = _buffer.slice(tcpHeaderSize, tcpHeaderSize + tcpLength);
      packet = decode(tcpPacket);
      debug('recived tcpPacket', packet);
      if (packet) {
        packets.push(packet);
      }
      _buffer = _buffer.slice(tcpLength + tcpHeaderSize);
    }
  } while (_buffer.length >= headerSize && packet)

  return {_buffer, packets};
};

export default {
  parse,
  decode,
};
