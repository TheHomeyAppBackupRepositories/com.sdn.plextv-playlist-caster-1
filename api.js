module.exports = {
  async configpost({ homey, query, params, body }) {
    if (params.config == 'updateIgnore') {
      try {
        let plexIgnores = homey.settings.get('ignoredServers');
        if (plexIgnores == null) plexIgnores = [];
        if (body.checked) {
          plexIgnores.push(body.id);
          await homey.settings.set('ignoredServers', plexIgnores);
        } else {
          const index = plexIgnores.indexOf(body.id);
          if (index > -1) {
            plexIgnores.splice(index, 1);
            await homey.settings.set('ignoredServers', plexIgnores);
          }
        }
        return Promise.resolve(null);
      } catch (err) {
        return Promise.reject(err);
      }
    } else if (params.config == 'authPlex') {
      let newToken = {};
      try {
        newToken = await homey.app.authenticateForToken(body.user, body.pass);
        if (newToken.error) {
          return Promise.reject(homey.__('inAppErrors.authFailed'));
        } else {
          homey.settings.set('plexToken', newToken.authToken);
          return Promise.resolve(homey.__('inAppErrors.authSucess'));
        }
      } catch (err) {
        return Promise.reject(err);
      }
    } else {
      return Promise.reject(homey.__('api.errUnknownCall'));
    }
  },
  async configget({ homey, query, params }) {
    if (params.getData == 'getServers') {
      let serverList = [];
      try {
        serverList = await homey.app.getServers(true);
        if (serverList.error) {
          return Promise.reject(homey.__('inAppErrors.authFailed'));
        } else {
          let plexIgnores = homey.settings.get('ignoredServers');
          if (plexIgnores == null) plexIgnores = [];
          for (var i = 0; i < serverList.length; i++) {
            if (plexIgnores.indexOf(serverList[i].data.id) > -1) {
              serverList[i].data.status = 'IGNORED';
              serverList[i].statusHR = homey.__('api.srvIgnored');
            } else if (serverList[i].data.status == 'INTERNAL') {
              serverList[i].statusHR = homey.__('api.srvInt');
            } else if (serverList[i].data.status == 'EXTERNAL') {
              serverList[i].statusHR = homey.__('api.srvExt');
            } else if (serverList[i].data.status == 'OFFLINE') {
              serverList[i].statusHR = homey.__('api.srvOffline');
            }
            if (serverList[i].data.owned === true) {
              serverList[i].data.owner = homey.__('api.yes');
            } else {
              serverList[i].data.owner = homey.__('api.no');
            }
          }
          return Promise.resolve(serverList);
        }
      } catch (err) {
        return Promise.reject(err);
      }
    } else if (params.getData == 'getPlaylists') {
      if (homey.app.apiAccessAllowed === true) {
        let allPlayLists = await homey.app.getAllPlaylists();
        let exposedList = [];
        for (let i = 0; i < allPlayLists.length; i++) {
          let newList = {
            name: allPlayLists[i].name,
            url: allPlayLists[i].url,
            srv: allPlayLists[i].server.data.actual_device_id
          }
          exposedList.push(newList);
        }
        return Promise.resolve(exposedList);
      } else {
        return Promise.resolve({ error: 'API Access not granted!' });
      }
    } else if (params.getData == 'getPlaylist') {
      if (homey.app.apiAccessAllowed === true) {
        if (query.playlist) {
          if (query.server) {
            let allPlayLists = await homey.app.getAllPlaylists();
            let foundList = false;
            for (let i = 0; i < allPlayLists.length; i++) {
              if (query.playlist == allPlayLists[i].url && query.server == allPlayLists[i].server.data.actual_device_id) {
                foundList = true;
                let exposedList = await homey.app.getMP3s(allPlayLists[i]);
                return Promise.resolve(exposedList);
              }
            }
            if (foundList === false) {
              return Promise.resolve({ error: 'Requested list was not found!' });
            }
          } else {
            return Promise.resolve({ error: 'No server given!' });
          }
        } else {
          return Promise.resolve({ error: 'No playlist given!' });
        }
      } else {
        return Promise.resolve({ error: 'API Access not granted!' });
      }
    } else {
      return Promise.reject(homey.__('api.errUnknownCall'));
    }
  }
};
