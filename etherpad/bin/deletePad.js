/*
  A tool for deleting pads from the CLI, because sometimes a brick is required to fix a window.
*/

if(process.argv.length != 3)
{
  console.error("Use: node deletePad.js $PADID");
  process.exit(1);
}
//get the padID
var padId = process.argv[2];

var db, padManager, pad, settings;
var neededDBValues = ["pad:"+padId];

var npm = require("../src/node_modules/npm");
var util = require("util");

// Preserve the original crash semantics: a rejected promise here should
// terminate the process with a nonzero exit and a stack trace, exactly like
// `if(err) throw err` did inside the old async.series completion callback.
process.on("unhandledRejection", function(err) { throw err; });

async function main()
{
  // load npm
  await util.promisify(npm.load.bind(npm))({}).catch(function(er) {
    console.error("Could not load NPM: " + er)
    process.exit(1);
  });

  // load modules
  settings = require('../src/node/utils/Settings');
  db = require('../src/node/db/DB');

  // initialize the database
  await util.promisify(db.init.bind(db))();

  // delete the pad and its links
  padManager = require('../src/node/db/PadManager');

  // NOTE: PadManager.removePad(padId) takes no callback at this revision --
  // it fire-and-forgets db.remove and returns synchronously. The old code
  // passed a callback that was never invoked; the live completion path was a
  // stray synchronous callback(). So there is nothing to await here.
  padManager.removePad(padId);

  console.log("Finished deleting padId: "+padId);
  process.exit();
}

main();
