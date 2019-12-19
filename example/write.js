const AdsClient = require("../dist/main.js");
const util = require("util");

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
    host: "172.16.21.6",
    netID: "5.9.36.191.1.1",
    amsPort: 801
  }
};

const client = new AdsClient.default(options);
client
  .connect()
  .then(async () => {
    console.log("connected");

    // Write a number
    await client.writeTag(".Alvalyckan.HotWaterCount", 3).catch(err => {
      console.log("failed to write: ", err);
    });

    // Write to a sub sub item
    await client
      .writeTag(".Alvalyckan.Alarms.IBJFB_UTOMHUS", false)
      .catch(err => {
        console.log("failed to write: ", err);
      });

    // Write a whole structure
    await client
      .writeTag(".Alvalyckan.Alarms", {
        IBJFB_KYL: true,
        IBJFB_FRYS: false,
        IBJFB_UTOMHUS: true
      })
      .catch(err => {
        console.log("failed to write: ", err);
      });
  })
  .catch(err => {
    console.log("failed to connect: ", err);
  });
