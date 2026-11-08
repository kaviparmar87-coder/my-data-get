const { runFullSync } = require('./sync');

runFullSync()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok === false ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
