const AdsClient = require("../dist/main.js");

process.on("exit", function() {
  console.log("exit");
});

process.on("SIGINT", function() {
  client.close().then(() => {
    process.exit();
  });
});

const options = {
  target: {
    host: "192.168.114.23",
    netID: "192.168.114.23.1.1",
    amsPort: 801
  },
  source: {
    netID: "192.168.114.249.1.1"
  },
  loadSymbols: false,
  loadDataTypes: false,
  reconnect: true,
  reconnectInterval: 1000
};


const client = new AdsClient.default(options);
client
  .connect()
  .then(async () => {
    // console.log('DEVICE STATE', await client.getDeviceState());
    // console.log('DEVICE INFO', await client.getDeviceInfo());
    /*
    setInterval(async () => {
      console.log('Tag', await client.readTag('.starrStorages'));
    }, 1000);
    */
    /*
   await client.monitorTag('.starrStorages', (value, timestamp) => {
     console.log('value changed', value, 'timestamp', timestamp);
   });
   */
    /*

  await client.monitorTag('.starrStorages', (value, timestamp) => {
    console.log('value changed', value[1].SNAME, 'timestamp', timestamp);
  });
   let arr = await client.readTag('.starrStorages');
   console.log('ENNE KIRJUTAMIST', arr[1].SNAME);
   arr[1].SNAME = 'test' + Math.floor(Math.random() * Math.floor(254));
   await client.writeTag('.starrStorages', arr);
  */
    console.log(await client.monitorTag('.starrStorages[2].ARRACLCARD[1].SCARDID', (value, timestamp) => {
      console.log('value changed', value, 'timestamp', timestamp);
    }));
    setInterval(async () => {
      await client.writeTag('.starrStorages[2].ARRACLCARD[1].SCARDID', 'Tere'+ Math.floor(Math.random() * Math.floor(254)))
        .catch(err => {});
    }, 1000);
    /*
    setInterval(async () => {
      await client.writeTag('StorageBox33Simulation.byCommunicationModuleNumber', Math.floor(Math.random() * Math.floor(254)));
    }, 1000);
    */
    // console.log('Tag', await client.readTag('StorageBox33Simulation.byCommunicationModuleNumber'));
    //console.log('Tagdate', await client.readTag('SYSTEMTIME.DATETIME'));
    //console.log('Tagt8', await client.readTag('SYSTEMTIME.FBTIME'));
    // console.log('Tag', await client.readTag('TRAPS.CPULATENCYTON'));
    // console.log('Tag2', await client.readTag('STORAGEBOX33SIMULATION.FBSECURITY'));
    // console.log('DEVICE SYMBOLS', await client.getSymbols());
    //console.log('DEVICE SYMBOLS', await client.getDataTypes());
    //console.log('me oleme siin');
    ///const symols = await client.getSymbols();
    //console.log('me ja nüüd siin');
    // console.log(symols);
    //const types = await client.getDataTypes();
    /*

    for (const prop in symols) {
        if (prop.startsWith('.STARRSTORAGES')) {
            console.log(symols[prop]);
        }
    }
    *
    for (const prop in types) {
        if (prop.startsWith('ST_STORAGEBOX')) {
            // console.log(types[prop]);
        }
    }

    await client.readTag('.starrStorages');
    */
  });

  client.on('error', err => {
    console.log('saime ka siia errori', err);
  });

  client.on('reconnect', () => {
    console.log('reconnectio started');
  });

  client.on('connected', () => {
    console.log('Connected');
  });

  client.on('close', () => {
    console.log('Disconnected');
  });
