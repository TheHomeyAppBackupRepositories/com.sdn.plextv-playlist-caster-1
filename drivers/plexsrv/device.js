'use strict';

const Homey = require('homey');
const Util = require('util');

class PlexMS_Device extends Homey.Device {

	onInit() {
		this.log('Starting PlexMS_Device', this.getName(), '..');
		this.setUnavailable(this.homey.__('api.srvOffline'));
		this.registerCapabilityListener('button.force_data_refresh', async () => {
			this.refreshServerData();
			return;
		});
		// Register server update task
		let data = this.getData();
		// Remove old task if present..
		this._connProbeInterval = this.homey.setInterval(this.probeConnectionStatus.bind(this), 60000);
		this.probeConnectionStatus();
		this.log('PlexMS_Device', this.getName(), 'started.');
	} //onInit

	onDeleted() {
		this.log('PlexMS_Device Deleted:', this.getName());
		// Unregister server update task
		if (this._connProbeInterval !== null) {
			this.homey.clearInterval(this._connProbeInterval);
		}
	} //onDeleted

	async probeConnectionStatus() {
		// Test connection URLs and update the server device if required..
		let connectionData = this.getStoreValue('connection');
		//this.log('probeConnectionStatus:', this.getName(), 'Connection Data:', connectionData);
		if (connectionData == null) {
			this.refreshServerData();
		} else {
			if (await this.homey.app.isReachable(connectionData.uri) === true) {
				if (!this.getAvailable()) this.setAvailable();
				this.homey.app.getPlaylists(connectionData.uri)
				.then(plList => {
					let v_count = 0;
					let a_count = 0;
					if (plList.elements[0].name == 'html') {
						// Did not get a media container. This happens if we are not authorized for the source..
					} else if (plList.elements[0].elements) {
						for (let i = 0; i < plList.elements[0].elements.length; i++) {
							if (plList.elements[0].elements[i].attributes.playlistType == 'audio') {
								a_count++;
							} else if (plList.elements[0].elements[i].attributes.playlistType == 'video') {
								v_count++;
							}
						}
					}
					if (this.getCapabilityValue('plex_playlist_count_audio') != a_count) {
						this.setCapabilityValue('plex_playlist_count_audio', a_count)
						.catch(this.error);
					}
					if (this.getCapabilityValue('plex_playlist_count_video') != v_count) {
						this.setCapabilityValue('plex_playlist_count_video', v_count)
						.catch(this.error);
					}
				})
				.catch(err => {
					this.homey.app.error(this.getName(), 'probeConnectionStatus: getPlaylists:', err);
				});
				this.setStoreValue('stage', -1);
			} else {
				// Server not reachable..
				if (this.getAvailable()) this.setUnavailable(this.homey.__('api.srvOffline'));
				let connectionStage = this.getStoreValue('stage');
				if (connectionStage == null) {
					connectionStage = 0;
				}
				connectionStage++;
				this.log('Reconnect Stage Counter:', connectionStage);
				if (connectionStage == 0) {
					this.refreshServerData();
				} else if (connectionStage >= 3) {
					connectionStage = -1;
				}
				this.setStoreValue('stage', connectionStage);
			}
		}
	}

	refreshServerData() {
		let data = this.getData();
		this.homey.app.getServers()
		.then(servers => {
			for (let i = 0; i < servers.length; i++) {
				if (servers[i].data.actual_device_id == data.actual_device_id) {
					// Connection Status
					let srv_conn = '?';
					if (servers[i].data.status == 'INTERNAL') {
						srv_conn = this.homey.__('api.srvInt');
						if (!this.getAvailable()) this.setAvailable();
					} else if (servers[i].data.status == 'EXTERNAL') {
						srv_conn = this.homey.__('api.srvExt');
						if (!this.getAvailable()) this.setAvailable();
					} else if (servers[i].data.status == 'OFFLINE') {
						if (this.getAvailable()) this.setUnavailable(this.homey.__('api.srvOffline'));
						break;
					}
					// Remember new data on devices..
					this.setStoreValue('connection', servers[i].data);
					// Update device in Homey..
					this.setCapabilityValue('plex_connection', srv_conn)
					.catch(this.error);
					// Server Ownership
					this.setCapabilityValue('plex_owner', servers[i].data.owned)
					.catch(this.error);
					// Playlist Stats
					if(srv_conn != '?') {
						this.homey.app.getPlaylists(servers[i].data.uri)
						.then(plList => {
							let v_count = 0;
							let a_count = 0;
							if (plList.elements[0].name == 'html') {
								// Did not get a media container. This happens if we are not authorized for the source..
							} else if (plList.elements[0].elements) {
								for (let i = 0; i < plList.elements[0].elements.length; i++) {
									if (plList.elements[0].elements[i].attributes.playlistType == 'audio') {
										a_count++;
									} else if (plList.elements[0].elements[i].attributes.playlistType == 'video') {
										v_count++;
									}
								}
							}
							this.setCapabilityValue('plex_playlist_count_audio', a_count)
							.catch(this.error);
							this.setCapabilityValue('plex_playlist_count_video', v_count)
							.catch(this.error);
						});
					} else {
						this.setCapabilityValue('plex_playlist_count_audio', 0)
						.catch(this.error);
						this.setCapabilityValue('plex_playlist_count_video', 0)
						.catch(this.error);
					}
					break;
				}
			}
		});
	} //refreshServerData
}

module.exports = PlexMS_Device;
