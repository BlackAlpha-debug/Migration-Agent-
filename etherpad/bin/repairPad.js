/*
  This is a repair tool. It extracts all datas of a pad, removes and inserts them again.
*/

console.warn("WARNING: This script must not be used while etherpad is running!");

if(process.argv.length != 3)
{
  console.error("Use: node bin/repairPad.js $PADID");
  process.exit(1);
}
//get the padID
var padId = process.argv[2];

var db, padManager, pad, settings;
var neededDBValues = ["pad:"+padId];

var npm = require("../src/node_modules/npm");
var util = require("util");

// Preserve the original 'if(err) throw err' crash semantics: a rejected
// promise terminates with a nonzero exit and a stack trace, rather than the
// exit-0 warning a naive .catch would produce.
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

  //initialize the database
  await util.promisify(db.init.bind(db))();

  //get the pad
  padManager = require('../src/node/db/PadManager');
  pad = await util.promisify(padManager.getPad.bind(padManager))(padId);

  //add all authors
  var authors = pad.getAllAuthors();
  for(var i=0;i<authors.length;i++)
  {
    neededDBValues.push("globalAuthor:" + authors[i]);
  }

  //add all revisions
  var revHead = pad.head;
  for(var i=0;i<=revHead;i++)
  {
    neededDBValues.push("pad:"+padId+":revs:" + i);
  }

  //get all chat values
  var chatHead = pad.chatHead;
  for(var i=0;i<=chatHead;i++)
  {
    neededDBValues.push("pad:"+padId+":chat:" + i);
  }

  //
  // NB: this script doesn't actually does what's documented
  //     since the `value` fields in the following `.forEach`
  //     block are just the array index numbers
  //
  //     the script therefore craps out now before it can do
  //     any damage.
  //
  //     See gitlab issue #3545
  //
  // This abort guard is replicated from the real historical migration
  // (PR #3559, commit c499a0803). The forEach below is unconditionally broken
  // (`value` is the array index, not data) and its fire-and-forget db.remove/
  // db.set writes racy garbage, so PR #3559 disabled the block entirely rather
  // than preserve or "fix" it. We match that: abort before any damage. The
  // guard is unconditional because the bug is unconditional -- every call hits
  // the broken block, so there is no non-broken path being sacrificed.
  console.info("aborting [gitlab #3545]");
  process.exit(1);

  // now fetch and reinsert every key (UNREACHABLE: see abort guard above)
  db = db.db;
  neededDBValues.forEach(function(key, value) {
    console.debug("Key: "+key+", value: "+value);
    db.remove(key);
    db.set(key, value);
  });

  console.info("finished");
  process.exit();
}

main();

//get the pad object
//get all revisions of this pad
//get all authors related to this pad
//get the readonly link related to this pad
//get the chat entries related to this pad
//remove all keys from database and insert them again
