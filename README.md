
# beckhoff-js

> This is a Promise based client implementation of the Twincat ADS protocol from Beckhoff written in TypeScript.

## API

### Connection options

```typescript
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
```

### Connect to a PLC and read a tag

```javascript
const AdsClient = require('beckhoff-js');

const options = {
  target: {
    host: "172.16.21.6",
    netID: "5.9.36.191.1.1",
    amsPort: 801
  }
};

const client = new AdsClient.default(options);
client
  .connect()
  .then(async () => {
    // Read a tag
    const bTest = await client.readTag(".bTest");
    console.log('bTest value is', bTest);
  });
```

### Connect to a PLC and write a tag

```javascript
const AdsClient = require('beckhoff-js');
const options = {
  target: {
    host: "172.16.21.6",
    netID: "5.9.36.191.1.1",
    amsPort: 801
  }
};
const client = new AdsClient.default(options);
client
  .connect()
  .then(async () => {
    // write a tag
    return client.writeTag(".bTest", false);
  })
  .catch(err => {
    console.log("failed to write: ", err);
  });
```

### Connect to a PLC and monitor a tag

```javascript
const AdsClient = require('beckhoff-js');
const options = {
  target: {
    host: "172.16.21.6",
    netID: "5.9.36.191.1.1",
    amsPort: 801
  }
};
const client = new AdsClient.default(options);
client
  .connect()
  .then(async () => {
    // write a tag
    return client.montorTag(".bTest",  (value, timestamp) => {
      console.log(`.bTest value changed ${value} at ${timestamp}`)
    });
  })
  .catch(err => {
    console.log("failed monitor item: ", err);
  });
```

### Events

Client extends `EventEmtter` and emits following events:

- `error` Errors. All methods are rejected if they end up with error. Here we have all other errors like connection errors
- `connected` Connection established (or reconnection)
- `reconnect` Reconnection started
- `close` Connection closed

### Symbols and tags

The library will automaticly load symbols and tags from the PLC. It will also keep track of sub items of a symbol for you.

All of the following `writeTag` calls are valid where `.Alvalyckan` is the symbol and the rest of the path is just sub items. The same is true for all of the `Tag` functions.

```javascript
await client.writeTag(".Alvalyckan.HotWaterCount", 3)
await client.writeTag(".Alvalyckan.Alarms.IBJFB_UTOMHUS", false)
await client
  .writeTag(".Alvalyckan.Alarms", {
    IBJFB_KYL: true,
    IBJFB_FRYS: false,
    IBJFB_UTOMHUS: true
  });
```

### Arrays and tags

This library supports `Arrays`. ST Arrays may have different starting point, Nodejs Arrays startng point is allways 0.
If Array starting point is different, all members before that are `undefined` (`<empty item>`).
Multi dimensional arrays are supported. MultiArray is not supported yet.
eg.

```javascript
 //  arrAlarm: ARRAY [1 .. 2] OF BOOL;
 await client.readTag(".arrAlarm") // [ <1 empty item>, true, true ]
```

If writing whole array, whole array needs to supplied.

```javascript
 //  arrAlarm: ARRAY [1 .. 2] OF BOOL;
 await client.writeTag(".arrAlarm". [undefined, false, false])
```

You can use array indexes for read, write and monitor:

```javascript
 //  arrAlarm: ARRAY [1 .. 2] OF BOOL;
 await client.readTag(".arrAlarm[1]") // true
```

## Credits, sources and inspiration

There is a lot of projects and information on Beckhoff ADS out there! Below you'll find the ones that has been my primary inspiration and source of information.

* https://github.com/src-one/twincat-ads
* https://github.com/tomcx/tame4
* https://github.com/stlehmann/pyads
* https://github.com/Beckhoff/ADS
* https://github.com/DEMCON/python-ads
* https://github.com/roccomuso/node-ads
* https://github.com/dkleber89/ioBroker.beckhoff
* https://infosys.beckhoff.com/content/1033/tcadsamsspec/html/tcadsamsspec_amstcppackage.htm?id=2322770954845974327
