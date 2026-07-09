/*
  This is a debug tool. It checks all revisions for data corruption
*/

if(process.argv.length != 2)
{
  console.error("Use: node bin/checkAllPads.js");
  process.exit(1);
}

//initialize the variables
var db, settings, padManager;
var npm = require("../src/node_modules/npm");
var util = require("util");

var Changeset = require("../src/static/js/Changeset");

// Preserve the original 'if(err) throw err' crash semantics: a rejected
// promise terminates with a nonzero exit and a stack trace, rather than the
// exit-0 warning a naive .catch would produce.
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

  //load pads
  padManager = require('../src/node/db/PadManager');
  var res = await util.promisify(padManager.listAllPads.bind(padManager))();
  var padIds = res.padIDs;

  var dbGet = util.promisify(db.db.get.bind(db.db));

  // Outer async.forEach over pads was PARALLEL; Promise.all preserves that.
  // (per-pad error lines therefore interleave nondeterministically, as before)
  await Promise.all(padIds.map(async function(padId)
  {
    // NOTE: the original had `if (err) { callback(err); }` with NO return here,
    // so on a getPad error it signalled the error and then fell through onto
    // `pad.pool` of an undefined pad -- a pre-existing bug (undefined behavior;
    // see MIGRATION_BASELINE.md). Awaiting getPad instead lets a genuine error
    // propagate to a clean nonzero exit, matching PR #3559's intent, rather
    // than reproducing the undefined fall-through byte-for-byte. In practice
    // getPad on a listAllPads id does not error (it loads or creates the pad).
    var pad = await util.promisify(padManager.getPad.bind(padManager))(padId);

    //check if the pad has a pool
    if(pad.pool === undefined )
    {
      console.error("[" + pad.id + "] Missing attribute pool");
      return;
    }

    //create an array with key kevisions
    //key revisions always save the full pad atext
    var head = pad.getHeadRevisionNumber();
    var keyRevisions = [];
    for(var i=0;i<head;i+=100)
    {
      keyRevisions.push(i);
    }

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
        var revision = await dbGet("pad:"+pad.id+":revs:" + revNum);
        revisions[revNum] = revision;
      }));

      //check if the revision exists
      if (revisions[keyRev] == null)
      {
        console.error("[" + pad.id + "] Missing revision " + keyRev);
        continue;
      }

      //check if there is a atext in the keyRevisions
      if(revisions[keyRev].meta === undefined || revisions[keyRev].meta.atext === undefined)
      {
        console.error("[" + pad.id + "] Missing atext in revision " + keyRev);
        continue;
      }

      var apool = pad.pool;
      var atext = revisions[keyRev].meta.atext;

      for(var i=keyRev+1;i<=keyRev+100 && i<=head; i++)
      {
        try
        {
          //console.log("[" + pad.id + "] check revision " + i);
          var cs = revisions[i].changeset;
          atext = Changeset.applyToAText(cs, atext, apool);
        }
        catch(e)
        {
          console.error("[" + pad.id + "] Bad changeset at revision " + i + " - " + e.message);
          // The original called the iterator callback and returned here, i.e.
          // it stopped checking further revisions for THIS key revision and
          // moved on. `break` matches that (PR #3559 neither broke nor continued
          // here, and referenced an undefined `i` in the message -- both changes
          // we intentionally do not replicate).
          break;
        }
      }
    }
  }));

  console.log("finished");
  process.exit(0);
}

main();
