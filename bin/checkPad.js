/*
  This is a debug tool. It checks all revisions for data corruption
*/

if(process.argv.length != 3)
{
  console.error("Use: node bin/checkPad.js $PADID");
  process.exit(1);
}
//get the padID
var padId = process.argv[2];

//initialize the variables
var db, settings, padManager;
var npm = require("../src/node_modules/npm");
var util = require("util");

var Changeset = require("ep_etherpad-lite/static/js/Changeset");

// Preserve the original 'if(err) throw err' crash semantics: a rejected
// promise terminates with a nonzero exit and a stack trace, rather than the
// exit-0 warning a naive .catch would produce. This mirrors how a db.db.get
// error propagated to the async.series completion callback and was thrown.
process.on("unhandledRejection", function(err) { throw err; });

async function main()
{
  //load npm
  await util.promisify(npm.load.bind(npm))({});

  //load modules
  settings = require('../src/node/utils/Settings');
  db = require('../src/node/db/DB');

  //initialize the database
  await util.promisify(db.init.bind(db))();

  //get the pad
  padManager = require('../src/node/db/PadManager');

  // The original ignored the error from doesPadExists and only branched on
  // `exists`; on a DB error `exists` was undefined and the code fell into the
  // "Pad does not exist" path. .catch(() => false) preserves exactly that.
  var exists = await util.promisify(padManager.doesPadExists.bind(padManager))(padId).catch(function() { return false; });
  if(!exists)
  {
    console.error("Pad does not exist");
    process.exit(1);
  }

  var pad = await util.promisify(padManager.getPad.bind(padManager))(padId);

  //create an array with key revisions
  //key revisions always save the full pad atext
  var head = pad.getHeadRevisionNumber();
  var keyRevisions = [];
  for(var i=0;i<head;i+=100)
  {
    keyRevisions.push(i);
  }

  var dbGet = util.promisify(db.db.get.bind(db.db));

  //run trough all key revisions (async.forEachSeries -> sequential for..of)
  for(var keyRev of keyRevisions)
  {
    //create an array of revisions we need till the next keyRevision or the End
    var revisionsNeeded = [];
    for(var i=keyRev;i<=keyRev+100 && i<=head; i++)
    {
      revisionsNeeded.push(i);
    }

    //this array will hold all revision changesets
    var revisions = [];

    //run trough all needed revisions and get them from the database
    //(async.forEach -> parallel Promise.all, preserving concurrent dispatch)
    await Promise.all(revisionsNeeded.map(async function(revNum)
    {
      var revision = await dbGet("pad:"+padId+":revs:" + revNum);
      revisions[revNum] = revision;
    }));

    //check if the pad has a pool
    if(pad.pool === undefined )
    {
      console.error("Attribute pool is missing");
      process.exit(1);
    }

    //check if there is an atext in the keyRevisions
    if(revisions[keyRev] === undefined || revisions[keyRev].meta === undefined || revisions[keyRev].meta.atext === undefined)
    {
      console.error("No atext in key revision " + keyRev);
      continue;
    }

    var apool = pad.pool;
    var atext = revisions[keyRev].meta.atext;

    for(var i=keyRev+1;i<=keyRev+100 && i<=head; i++)
    {
      try
      {
        //console.log("check revision " + i);
        var cs = revisions[i].changeset;
        atext = Changeset.applyToAText(cs, atext, apool);
      }
      catch(e)
      {
        console.error("Bad changeset at revision " + i + " - " + e.message);
        // The original called the iterator callback and returned from the
        // forEach-completion here, i.e. it stopped checking further revisions
        // for THIS key revision and moved on to the next one. `break` matches
        // that (NOT `continue`, which PR #3559 used and which keeps applying
        // later changesets against a stale atext -- a behavior change).
        break;
      }
    }
  }

  console.log("finished");
  process.exit(0);
}

main();
