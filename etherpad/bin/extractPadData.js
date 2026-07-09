/*
  This is a debug tool. It helps to extract all datas of a pad and move it from an productive environment and to a develop environment to reproduce bugs there. It outputs a dirtydb file
*/

if(process.argv.length != 3)
{
  console.error("Use: node extractPadData.js $PADID");
  process.exit(1);
}
//get the padID
var padId = process.argv[2];

var db, dirty, padManager, pad, settings;
var neededDBValues = ["pad:"+padId];

var npm = require("../node_modules/ep_etherpad-lite/node_modules/npm");
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
  settings = require('../node_modules/ep_etherpad-lite/node/utils/Settings');
  db = require('../node_modules/ep_etherpad-lite/node/db/DB');
  // NOTE: this require path is broken at this revision (the installed package is
  // 'ueberdb2', and 'dirty' is not nested under it) -- the script is
  // dead-on-arrival with MODULE_NOT_FOUND here, both before and after this
  // migration. PR #3559 additionally repaired this path; that is a separate bug
  // outside the scope of this callback->async/await conversion, so it is left
  // as-is to preserve the exact pre-existing behavior (see MIGRATION_PLAN.md).
  dirty = require("../node_modules/ep_etherpad-lite/node_modules/ueberDB/node_modules/dirty")(padId + ".db");

  //initialize the database
  await util.promisify(db.init.bind(db))();

  //get the pad
  padManager = require('../node_modules/ep_etherpad-lite/node/db/PadManager');
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

  //get and set all values
  // Preserves the original async.forEach semantics (parallel dispatch) via
  // Promise.all; the per-key body is unchanged apart from callback -> await.
  var wrappedGet = util.promisify(db.db.db.wrappedDB.get.bind(db.db.db.wrappedDB));
  var dirtySet = util.promisify(dirty.set.bind(dirty));
  await Promise.all(neededDBValues.map(async function(dbkey)
  {
    var dbvalue = await wrappedGet(dbkey);

    if(dbvalue && typeof dbvalue != 'object'){
      dbvalue=JSON.parse(dbvalue); // if it's not json then parse it as json
    }

    await dirtySet(dbkey, dbvalue);
  }));

  console.log("finished");
  process.exit();
}

main();

//get the pad object
//get all revisions of this pad
//get all authors related to this pad
//get the readonly link related to this pad
//get the chat entries related to this pad
