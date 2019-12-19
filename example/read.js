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

    // Read a tag
    const bTest = await client.readTag(".Alvalyckan").catch(err => {
      console.log("failed to read: ", err);
    });

    console.log(".Alvalyckan value ", bTest);

    // Activate a monitor (notification) for a tag (or in this case a tag sub item)
    await client
      .monitorTag(".Alvalyckan.Alarms", (value, timestamp) =>
        console.log("monitor callback: ", value, timestamp)
      )
      .catch(err => {
        console.log("failed to monitor: ", err);
      });
  })
  .catch(err => {
    console.log("failed to connect: ", err);
  });
