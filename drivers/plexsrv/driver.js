'use strict';

const Homey = require('homey');

class PlexMS_Driver extends Homey.Driver {
	onInit() {
		this.log("Starting PlexMS_Driver..");
		this.log("PlexMS_Driver is up.");
	}
	onPair(socket) {
		this.log('Plex Server pairing process started..');
		let self = this;
		socket.setHandler('showView', async (viewId) => {
			self.log('Calling Pairing View:', viewId);
			// Check for valid login by trying to get the server list..
			if (viewId == 'probe_token') {
				self.homey.app.getServers()
					.then(serverList => {
						if (serverList.length > 0) {
							// Skip login if we have at least one server..
							self.log('Found Servers, going to skip login..');
							socket.showView('list_devices');
						} else {
							self.log('No servers found, let us try to login.');
							socket.showView('login');
						}
					});
			}
			return Promise.resolve();
		});
		socket.setHandler('login', async (data) => {
			return self.homey.app.authenticateForToken(data.username, data.password)
				.then(valid => {
					if (valid.error) {
						return Promise.reject(valid.error);
					} else {
						self.homey.settings.set('plexToken', valid.authToken);
						return Promise.resolve(true);
					}
				})
				.catch(error => {
					return Promise.reject(error);
				});
		});
		socket.setHandler('list_devices', async (data) => {
			let returnVal = null;
			await self.homey.app.getServers()
				.then(plexServers => {
					returnVal = Promise.resolve(plexServers);
				})
				.catch(error => {
					returnVal = Promise.reject(error);
				});
			return returnVal;
		});
	}
}

module.exports = PlexMS_Driver;
