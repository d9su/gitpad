(function() {
  "use strict";

  var _git = require("gift");
  var _repo = null;

  /*
    Utilities
  */
  // Get todays date
  Date.prototype.today = function(){ 
      return this.getFullYear() + "-" + (((this.getMonth()+1) < 10)?"0":"") + (this.getMonth()+1) + "-" + ((this.getDate() < 10)?"0":"") + this.getDate();
  };

  // Get current time
  Date.prototype.time = function(){
       return ((this.getHours() < 10)?"0":"") + this.getHours() +"-"+ ((this.getMinutes() < 10)?"0":"") + this.getMinutes() +"-"+ ((this.getSeconds() < 10)?"0":"") + this.getSeconds();
  };

  // Get date and time, joining with '@'
  var now = function() {
    var date = new Date();
    return date.today() + '/' + date.time();
  }

  /*
    Initialize git repository
    - path(otional): path to your git repo, relative to where the script is called (ex, docpad root). Default to '.'
    - callback: receives (err, status)
  */
  exports.init = function(path, callback) {
    var _ref2;
    if (!callback) {
      _ref2 = [path, callback], callback = _ref2[0], path = _ref2[1];
    }
    if (!callback) throw new Error("a callback is required");
    if (!path) path = ".";

    _repo = _git(path);
    _repo.status(function(err, status) {
      if (err) {
        // Init failed
        console.log("Git repo initialization failed: " + err);

      } else {
        // Init successful
        console.log("Git repo initialization successful!");
      }

      callback(err, status);
    })
  };


  //
  //===== Show repo status (clean? tracked/untracked files?)
  //
  exports.showStatus = function(callback) {
    _repo.status(callback(err, status));
  }


  //
  //===== Document version control
  // Overview:
  //  List edit history of selected file
  //  List edit history of whole repo
  //  Save file (add and commit edit)
  //  Publish selected files
  //  Publish everything
  //  Remove file (remove and commit)
  //  Revert file to previous edit history (checkout file and commit, can retrive removed files)
  //

  /*
    Lists the history of a certain file
    - filename: name of the file being queried
    - limit(optional): an integer indicating how many commits to be shown, put "all" if want to see all commits (default 10)
    - callback: receives (err, commits)
    TODO: add callback
  */
  exports.showFileHistory = function(filename, limit, callback) {
    _repo.file_history(filename, limit, callback(err, commits));
  }

  /*
    Lists most recent commits applied to the whole repo (branch is default to "master")
    - limit: how many commits to return
    - skip(optional): how many commits to skip (for pagination)
    - callback: receives (err, commits)
  */
  exports.showHistory = function(limit, skip, callback) {
    _repo.commits("master", limit, skip, callback(err, commits));
  }

  /*
    Add the file to be saved into current commit and commit the file
    - filename: name of the file to be saved
    - msg: a message associated to the save action
    - callback: receives (err)
  */
  exports.saveFile = function(filename, msg, callback) {
    _repo.add(filename, function(err) {
      if (err) {
        callback(err);
        return;
      }

      _repo.commit('Saved file "' + filename + '": ' + msg, {}, callback);
    });
  }

  /*
    Remove a file from file system, then commit the removal
    - filename: name of the file to be removed
    - msg: a message associated to the removal
    - callback: receives (err)
    - NOTE: File removed by this command can be retrived back by using revertFile
  */
  exports.removeFile = function(filename, msg, callback) {
    _repo.remove(filename, function(err) {
      if (err) {
        callback(err);
        return;
      }

      _repo.commit('Removed file "' + filename + '": ' + msg, {}, callback);
    });
  }

  /*
    Revert a file back to a previous commited state, and then commit the revert
    - commitID: ID of the commit to revert to
    - filename: name of the file to be reverted
    - msg: a message associated to the revert
    - callback: receives (err)
  */
  exports.revertFile = function(commitID, filename, msg, callback) {
    _repo.checkoutFile(commitID, filename, function(err) {
      if (err) {
        callback(err);
        return;
      }

      exports.saveFile(filename, 'Reverted file "' + filename + '" to previous version from snapshot ID ' + commitID + ': ' + msg, callback);
    });
  }

  /*
    Publish selected file(s) (pushes selective file(s) from local repo to remote repo)
    - files: list of names of the files to be published
    - callback: receives (err), be aware that this will possibly be called multiple times, once for every file
    - NOTE: So many steps! So many things could go wrong! How should we remedy from them?
  */
  exports.publishFiles = function(files, msg, callback) {
    var fileCommits = [];
    // Get all the commit ids needing to be cherry-picked
    var fileCount = files.length;
    for (var i=0; i<files.length; i++) {
      _repo.file_history(files[i], 1, function(err, commits) {
        if (err) {
          callback(err);
          return;
        }

        fileCommits.push(commits[0].id);

        if (!--fileCount) {
          // Complete flow:
          // 1. Create (and automatically switch to) temp branch based on staging branch for this publish
          var temp_branch = "Publish-"+now();
          _repo.duplicate_branch(temp_branch, "staging", function(err) {
            if (err) {
              callback(err);
              return;
            }

            // 2. Cherry-pick all the commits into temp branch
            var cherryCount = fileCommits.length;
            for (var i=0; i<fileCommits.length; i++) {
              _repo.cherrypick(fileCommits[i], {"strategy": "recursive", "strategy-option": "theirs"}, function(err){
                if (err) {
                  callback(err);
                  return;
                }

                // 3. Switch to staging branch
                if (!--cherryCount) {
                  _repo.checkout("staging", function(err) {
                    if (err) {  // TODO: if error occurs here, user will not be able to switch back to original branch!!
                      callback(err);
                      return;
                    }

                    // 4. Use "merge --squash" to grab all the commits from temp into staging
                    _repo.merge(temp_branch, {squash: true}, "This comment will be ignored by git", function(err) {
                      if (err) {
                        callback(err);
                        return;
                      }

                      // 5. Commit changes squashed from temp branch
                      _repo.commit("Publish <DATE>\n" + msg, {a: true}, function(err) {
                        if (err) {
                          callback(err);
                        }
                        // 6. Delete temp branch
                        // Maybe we wanna keep it??

                        // 7. Switch back to original branch
                        _repo.checkout("master", callback);
                      });
                    });
                  });
                }
              });
            }
          });
        }


      });
    }
  }

  /*
    Publish everything!! -- Switch to staging branch -> merge with master branch -> switch back to master
    - msg: a message associated with the publish
    - callback: receives (err)
  */
  exports.publishAll = function(msg, callback) {
    _repo.checkout("staging", function(err) {
      if (err) {
        callback(err);
        return;
      }

      _repo.merge("master", {"no-ff": true}, "Publish <DATE>\n" + msg, function(err) {
        if (err) {
          callback(err);
        }

        _repo.checkout("master", callback);
      })
    });
  }


}).call(this);
