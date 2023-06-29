'use strict';

const Homey = require('homey');
const fetch = require('node-fetch');
const https = require('https');
const convert = require('xml-js');
const querystring = require("querystring");

// Player client support
var Client = require("castv2-client").Client;
var DefaultMediaReceiver = require("castv2-client").DefaultMediaReceiver;

// Discovery required includes
var util = require('util');
var mdns = require('multicast-dns');
var find = require('array-find');
var xtend = require('xtend');
var txt = require('mdns-txt')();

// Little helpers
var mime = require('mime-types');
var typeDetection = require('media-type');
var md5hash = require('md5');
const uuidv4 = require('uuid/v4');

class PlexPL2URL extends Homey.App {

	async sendMsgToTimeline(message) {
		this.homey.notifications.createNotification({ excerpt: message });
	}

	mdns_onResponse(response) {
		var txt_field = find(response.additionals, function (entry) {
			return entry.type === 'TXT';
		});
		var srv_field = find(response.additionals, function (entry) {
			return entry.type === 'SRV';
		});
		var a_field = find(response.additionals, function (entry) {
			return entry.type === 'A';
		});
		if (!txt_field || !srv_field || !a_field) {
			return;
		}
		var ip = a_field.data;
		var name = txt.decode(txt_field.data).fn;
		var description = txt.decode(txt_field.data).md;
		var port = srv_field.data.port;
		if (!ip || !name || !port) {
			return;
		}
		//create a proper id based on the device's record data
		var device_id = (port == 8009) ? `${a_field.name.split(".")[0]}-CCPP` : `${md5hash(name)}-CCPPG`;
		var is_group = (port == 8009) ? false : true;
		//console.log("Device:", device_id, "as", name);
		if (device_id in this.homey.app.foundCastDevices) {
			//We have seen this device already
			let old_device = this.homey.app.foundCastDevices[device_id];
			if (old_device.ip != ip || old_device.port != port || old_device.name != name) {
				//device has changed
				old_device.ip = ip;
				old_device.port = port;
				old_device.name = name;
				old_device.description = description;
				if (this.homey.app.proxy_onCastDeviceUpdate) this.homey.app.proxy_onCastDeviceUpdate(name, ip, port, device_id, description);
			}
		} else {
			//First time we see this device
			this.homey.app.foundCastDevices[device_id] = {
				ip: ip,
				port: port,
				name: name,
				description: description,
				id: device_id,
				is_group: is_group
			};
			if (this.homey.app.proxy_onCastDeviceNew) this.homey.app.proxy_onCastDeviceNew(name, ip, port, device_id, is_group, description);
		}
	}

	mdns_scan(cb_new, scan_interval, cb_update) {
		this.homey.app.mdns = mdns();
		this.homey.app.proxy_onCastDeviceNew = cb_new;
		this.homey.app.proxy_onCastDeviceUpdate = cb_update;
		this.homey.app.foundCastDevices = {};
		this.homey.app.mdns.on('response', this.homey.app.mdns_onResponse.bind(this));
		this.homey.app.sendMdnsQuery();
		if (scan_interval)
			this.homey.setInterval(this.homey.app.sendMdnsQuery.bind(this), scan_interval);
	}

	sendMdnsQuery() {
		this.homey.app.log('Sending mdsn query..');
		this.homey.app.mdns.query({
			questions: [{
				name: '_googlecast._tcp.local',
				type: 'PTR'
			}]
		});
	}

	async authenticateForToken(username, password) {
		const myUUID = this.homey.settings.get('plexUUID');
		const headers = {
			"Content-Type": "application/x-www-form-urlencoded",
			"X-Plex-Client-Identifier": myUUID,
			"X-Plex-Product": "Homey PlexTV Playlist Caster",
			"X-Plex-Version": this.homey.manifest.version
		};
		const loginUrl = 'https://plex.tv/users/sign_in.json';
		const data = `user[login]=${username}&user[password]=${password}`;
		// make request
		let response;
		try {
			response = await fetch(loginUrl, { method: 'POST', headers: headers, body: data })
		} catch (err) {
			return {
				err
			};
		}
		let responseJSON = await response.json();
		if (responseJSON.error) {
			throw new Error(responseJSON.error);
		}
		return responseJSON.user;
	}

	get apiAccessAllowed() {
		var apiAllowed = this.homey.settings.get('apiEnabled');
		if (apiAllowed) {
			if (apiAllowed === true) return true;
		}
		return false;
	}

	async getRawServers() {
		const myToken = this.homey.settings.get('plexToken');
		const headers = {
			"Content-Type": "text/xml",
			"X-Plex-Token": myToken
		};
		const data = null;
		// make request
		const httpsAgent = new https.Agent({
			rejectUnauthorized: false,
		});
		let response;
		try {
			response = await fetch(`https://plex.tv/pms/resources.xml?includeHttps=1`, { method: 'GET', headers: headers, body: data, agent: httpsAgent })
		} catch (err) {
			return {
				err
			};
		}
		let returnableResult = null;
		await response.text()
			.then(dataBody => {
				let responseJSON = JSON.parse(convert.xml2json(dataBody));
				if (responseJSON.error) {
					throw new Error(responseJSON.error);
				}
				returnableResult = responseJSON;
			})
			.catch(err => {
				returnableResult = err;
			});
		return returnableResult;
	}

	async getServers(getIgnored) {
		let plexIgnores = this.homey.settings.get('ignoredServers');
		if (plexIgnores == null) plexIgnores = [];
		let serversRaw = {};
		let serverList = [];
		try {
			serversRaw = await this.homey.app.getRawServers();
			for (let i = 0; i < serversRaw.elements[0].elements.length; i++) {
				// Product can be undefined here
				if (serversRaw.elements[0].elements[i].attributes === undefined) {
					this.homey.app.error('ERROR: getServers: UNDEFINED ELEMENT:', serversRaw.elements[0].elements[i]);
				} else if (serversRaw.elements[0].elements[i].attributes.product == 'Plex Media Server') {
					if (!getIgnored && plexIgnores.indexOf(`PlexMS_PLP_${serversRaw.elements[0].elements[i].attributes.clientIdentifier}`) > -1) continue;
					//console.log('Server Entry:', serversRaw.elements[0].elements[i]);
					let int_uri = '';
					let ext_uri = '';
					for (let j = 0; j < serversRaw.elements[0].elements[i].elements.length; j++) {
						//console.log(`${serversRaw.elements[0].elements[i].elements[j].attributes.uri}`);
						if (serversRaw.elements[0].elements[i].elements[j].attributes.local == '1') {
							int_uri = serversRaw.elements[0].elements[i].elements[j].attributes.uri;
						}
						if (serversRaw.elements[0].elements[i].elements[j].attributes.local == '0') {
							ext_uri = serversRaw.elements[0].elements[i].elements[j].attributes.uri;
						}
					}
					let serverStatus = "OFFLINE";
					let reachableAddr = "";
					//TODO: FIXME: always offline
					await this.homey.app.isReachable(int_uri)
						.then(result => {
							if (result == true) {
								serverStatus = "INTERNAL";
								reachableAddr = int_uri;
							}
						})
						.catch(err => {
							this.homey.app.error('getServers: isReachable(int):', err);
						});
					if (serverStatus == "OFFLINE") {
						await this.homey.app.isReachable(ext_uri)
							.then(resultExt => {
								if (resultExt == true) {
									serverStatus = "EXTERNAL";
									reachableAddr = ext_uri;
								}
							})
							.catch(err => {
								this.homey.app.error('getServers: isReachable(ext):', err);
							});
					}
					let newServerConnection = {
						name: serversRaw.elements[0].elements[i].attributes.name,
						data: {
							owned: (serversRaw.elements[0].elements[i].attributes.owned == '1') ? true : false,
							uri: reachableAddr,
							status: serverStatus,
							uri_int: int_uri,
							uri_ext: ext_uri,
							id: `PlexMS_PLP_${serversRaw.elements[0].elements[i].attributes.clientIdentifier}`,
							actual_device_id: serversRaw.elements[0].elements[i].attributes.clientIdentifier
						}
					}
					this.homey.app.log('Server Entry:', newServerConnection);
					serverList.push(newServerConnection);
				}
			}
			//console.log("Servers:", serverList);
		} catch (err) {
			this.homey.app.error('ERROR: getServers:', err);
		}
		return serverList;
	}

	async fetchTimeouted(url, options, timeout = 8000) {
		this.homey.app.log('GET:', url);
		return Promise.race([
			fetch(url, options),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Timeout')), timeout)
			)
		]);
	}

	async get(dataObject, uri, timeout) {
		if (timeout == null) timeout = 8000;
		const myToken = this.homey.settings.get('plexToken');
		const rootURL = (uri) ? uri : this.homey.app.serverUriToUse;
		const headers = {
			"Content-Type": "text/xml",
			"X-Plex-Token": myToken
		};
		const httpsAgent = new https.Agent({
			rejectUnauthorized: false,
		});
		const data = null;
		// make request
		let response = null;
		let returnableResult = null;
		await this.homey.app.fetchTimeouted(`${rootURL}${dataObject.path}`, { method: 'GET', headers: headers, body: data, agent: httpsAgent }, timeout)
			.then(answer => {
				response = answer;
			})
			.catch(err => {
				returnableResult = Promise.reject(err);
				this.homey.app.log('Get: Fetch Failed:', util.inspect(returnableResult, false, 10, true));
			});
		if (returnableResult != null) return returnableResult;
		await response.text()
			.then(dataBody => {
				let responseJSON = JSON.parse(convert.xml2json(dataBody));
				if (responseJSON.error) {
					returnableResult = Promise.reject(responseJSON.error);
				}
				if (returnableResult == null) returnableResult = Promise.resolve(responseJSON);
			})
			.catch(err => {
				returnableResult = Promise.reject(err);
			});
		return returnableResult;
	}

	getServersFromDriver() {
		let pmsDriver = this.homey.drivers.getDriver('plexsrv');
		let pmsDevices = pmsDriver.getDevices();
		let servers = [];
		for (let i = 0; i < pmsDevices.length; i++) {
			let newServer = {
				name: pmsDevices[i].getName(),
				data: pmsDevices[i].getStoreValue('connection')
			}
			servers.push(newServer);
		}
		return servers;
	}

	async getPlaylists(serverUri) {
		var returnable = null;
		await this.get({
			path: `/playlists`
		}, serverUri)
		.then(data => {
			returnable = data;
		})
		.catch(err => {
			this.homey.app.log('WARNING: getPlaylists: Problem getting playlists:', err);
			returnable = Promise.reject('Unable to load playlists!');
		});
		return returnable;
	}

	async getSiblingPlaylist(playlist, nextPrev) {
		if (playlist == null) return null;
		this.homey.app.log('getSiblingPlaylist:', nextPrev, 'for', playlist.name);
		let currentLists = await this.getAllPlaylists();
		// Identify current playlist
		let currentPl = null;
		for (let i = 0; i < currentLists.length; i++) {
			if (currentLists[i].url == playlist.url) {
				currentPl = currentLists[i];
				this.homey.app.log('getSiblingPlaylist: Found current:', currentPl.name);
				break;
			}
		}
		if (currentPl == null) throw new Error(this.homey.__('inAppErrors.cannotIdPl'));
		let plFirst = null;
		let plLast = null;
		let plPrevTmp = null;
		let plPrev = null;
		let plNext = null;
		for (let i = 0; i < currentLists.length; i++) {
			if (currentLists[i].plKind == currentPl.plKind) {
				if (plFirst == null) plFirst = currentLists[i];
				plLast = currentLists[i];
			}
		}
		for (let i = 0; i < currentLists.length; i++) {
			if (currentLists[i].plKind == currentPl.plKind) {
				if (plPrev != null && plNext == null) {
					plNext = currentLists[i];
					if (plNext != null) this.homey.app.log('getSiblingPlaylist: Found next:', plNext.name);
				}
				if (currentLists[i].url == currentPl.url) {
					plPrev = plPrevTmp;
					if (plPrev == null) plPrev = plLast;
					this.homey.app.log('getSiblingPlaylist: Found prev:', plPrev.name);
				}
				plPrevTmp = currentLists[i];
			}
		}
		let newPlaylist = null;
		if (nextPrev == 'next') {
			if (plNext != null) {
				newPlaylist = plNext;
				this.homey.app.log('getSiblingPlaylist: Choosing next:', plNext.name);
			} else {
				this.homey.app.log('getSiblingPlaylist: Choosing first:', plFirst.name);
				newPlaylist = plFirst;
			}
		} else {
			if (plPrev != null) {
				newPlaylist = plPrev;
				this.homey.app.log('getSiblingPlaylist: Choosing prev:', plPrev.name);
			} else {
				newPlaylist = plLast;
				this.homey.app.log('getSiblingPlaylist: Choosing last:', plLast.name);
			}
		}
		return newPlaylist;
	}

	async getMP3s(args) {
		let playlist = args.playlist;
		let anonMode = false;
		if (args.anonymize) {
			if (args.anonymize == 'ANON_OFF') {
				anonMode = false;
			} else if (args.anonymize == 'ANON_ON') {
				anonMode = true;
			}
		}
		let mediaList = [];
		// Refresh the server uri before trying to get the playlist as it might have changed!
		let servers = await this.homey.app.getServersFromDriver();
		let serverUri = '';
		for (let i = 0; i < servers.length; i++) {
			this.homey.app.log('Probe for Server:', servers[i].data.id, '==', playlist.server.data.id);
			if (servers[i].data.id == playlist.server.data.id) {
				serverUri = servers[i].data.uri;
				break;
			}
		}
		if (!serverUri || serverUri == '') throw new Error(this.homey.__('inAppErrors.noServer'));
		this.homey.app.log('Chosen Server URI:', serverUri);
		return this.homey.app.get({
			path: playlist.url
		}, serverUri, 30000).then(rawList => {
			const myToken = this.homey.settings.get('plexToken');
			const rootURL = serverUri;
			let mediaList = [];
			if (rawList.elements == null) throw new Error(this.homey.__('inAppErrors.cannotGetPl'));
			for (let i = 0; i < rawList.elements[0].elements.length; i++) {
				for (let j = 0; j < rawList.elements[0].elements[i].elements[0].elements.length; j++) {
					let theTitle;
					if (rawList.elements[0].elements[i].attributes.parentTitle && rawList.elements[0].elements[i].attributes.grandparentTitle) {
						theTitle = `${rawList.elements[0].elements[i].attributes.title} - ${rawList.elements[0].elements[i].attributes.parentTitle} - ${rawList.elements[0].elements[i].attributes.grandparentTitle}`;
					} else {
						theTitle = `${rawList.elements[0].elements[i].attributes.title}`;
					}
					let metaInfo;
					let currentType = typeDetection.fromString(mime.lookup(rawList.elements[0].elements[i].elements[0].elements[j].attributes.key) || 'audio/mpeg');
					if (currentType.type == 'video') {
						if (rawList.elements[0].elements[i].attributes.grandparentTitle) {
							// we got a series
							if (anonMode) {
								metaInfo = {
									type: 0,
									metadataType: 2
								}
							} else {
								metaInfo = {
									type: 0,
									metadataType: 2,
									seriesTitle: rawList.elements[0].elements[i].attributes.grandparentTitle,
									subtitle: rawList.elements[0].elements[i].attributes.title,
									title: rawList.elements[0].elements[i].attributes.title,
									season: parseInt(rawList.elements[0].elements[i].attributes.parentIndex),
									episode: parseInt(rawList.elements[0].elements[i].attributes.index),
									images: [
										{ url: `${rootURL}${rawList.elements[0].elements[i].attributes.grandparentThumb}?X-Plex-Token=${myToken}` }
									]
								}
							}
						} else {
							// we got a movie
							if (anonMode) {
								metaInfo = {
									type: 0,
									metadataType: 1
								}
							} else {
								metaInfo = {
									type: 0,
									metadataType: 1,
									title: rawList.elements[0].elements[i].attributes.title,
									subtitle: rawList.elements[0].elements[i].attributes.originalTitle,
									studio: rawList.elements[0].elements[i].attributes.studio,
									images: [
										{ url: `${rootURL}${rawList.elements[0].elements[i].attributes.grandparentThumb}?X-Plex-Token=${myToken}` }
									]
								}
							}
						}
					} else if (currentType.type == 'audio') {
						if (anonMode) {
							metaInfo = {
								type: 0,
								metadataType: 3
							}
						} else {
							metaInfo = {
								type: 0,
								metadataType: 3,
								albumName: rawList.elements[0].elements[i].attributes.parentTitle,
								artist: rawList.elements[0].elements[i].attributes.grandparentTitle,
								title: rawList.elements[0].elements[i].attributes.title,
								images: [
									{ url: `${rootURL}${rawList.elements[0].elements[i].attributes.grandparentThumb}?X-Plex-Token=${myToken}` }
								]
							}
						}
					} else {
						if (anonMode) {
							metaInfo = {
								type: 0,
								metadataType: 0
							}
						} else {
							metaInfo = {
								type: 0,
								metadataType: 0,
								title: theTitle,
								images: [
									{ url: `${rootURL}${rawList.elements[0].elements[i].attributes.grandparentThumb}?X-Plex-Token=${myToken}` }
								]
							}
						}
					}
					mediaList.push({
						autoplay: true,
						preloadTime: 3,
						startTime: 0,
						activeTrackIds: [],
						playbackDuration: parseInt(rawList.elements[0].elements[i].elements[0].attributes.duration),
						media: {
							contentId: `${rootURL}${rawList.elements[0].elements[i].elements[0].elements[j].attributes.key}?X-Plex-Token=${myToken}`,
							//contentType: "audio/mpeg",
							contentType: mime.lookup(rawList.elements[0].elements[i].elements[0].elements[j].attributes.key) || 'audio/mpeg',
							streamType: 'BUFFERED',
							metadata: metaInfo
						}
					});
				}
			}
			return mediaList;
		})
			.catch(err => {
				this.homey.app.error("ERROR:", err);
			});
	}

	/**
	* Shuffles array in place.
	* @param {Array} a items An array containing the items.
	*/
	shuffle(a) {
		var j, x, i;
		for (i = a.length - 1; i > 0; i--) {
			j = Math.floor(Math.random() * (i + 1));
			x = a[i];
			a[i] = a[j];
			a[j] = x;
		}
		return a;
	}

	newCastDevice(name, ip, port, id, group, description) {
		let newPlayer = {
			id: id,
			name: name,
			description: description,
			host: ip,
			port: port,
			is_group: group
		}
		this.homey.app.log('New Chromecast device:', name, ip, port, id, group, description);
		this.homey.app.cc_list.push(newPlayer);
	}

	updatedCastDevice(name, ip, port, id, description) {
		for (let i = 0; i < this.homey.app.cc_list.length; i++) {
			if (this.homey.app.cc_list[i].id == id) {
				this.homey.app.cc_list[i].name = name;
				this.homey.app.cc_list[i].description = description;
				this.homey.app.cc_list[i].host = ip;
				this.homey.app.cc_list[i].port = port;
				this.homey.app.cc_list[i].playerClient = null;
				break;
			}
		}
	}

	getPlaybackStatus(foundPlayer) {
		if (foundPlayer) {
			if (foundPlayer.playerStatus) {
				if (foundPlayer.playerStatus.playerState) {
					if (foundPlayer.playerStatus.playerState == 'IDLE' || foundPlayer.playerStatus.playerState == 'CANCELLED') {
						return 'IDLE';
					} else if (foundPlayer.playerStatus.playerState == 'PLAYING' || foundPlayer.playerStatus.playerState == 'LOADING' || foundPlayer.playerStatus.playerState == 'BUFFERING') {
						return 'PLAYING';
					} else if (foundPlayer.playerStatus.playerState == 'PAUSED') {
						return 'PAUSED';
					}
				} else {
					return 'IDLE';
				}
			} else {
				return 'IDLE';
			}
		} else {
			return 'IDLE';
		}
		return null;
	}

	async isReachable(uri) {
		if (uri == '') {
			this.homey.app.error('isReachable URI is null!');
			return false;
		}
		let resultReturn = false;
		await this.get({
			path: `/system`
		}, uri)
			.then(result => {
				resultReturn = true;
			})
			.catch(err => {
				resultReturn = false;
			});
		return resultReturn;
	}

	async getAllPlaylists() {
		this.homey.app.plexServers = await this.homey.app.getServersFromDriver();
		let playLists = [];
		let anyOnline = false;
		let anyListFound = false;
		for (let isrv = 0; isrv < this.homey.app.plexServers.length; isrv++) {
			if (this.homey.app.plexServers[isrv].data.status != "OFFLINE") {
				//console.log('Scanning Server:', this.homey.app.plexServers[isrv]);
				anyOnline = true;
				let plList = null;
				await this.homey.app.getPlaylists(this.homey.app.plexServers[isrv].data.uri)
				.then(data => {
					plList = data;
				})
				.catch(err => {
					this.homey.app.error('Playlist index was null!');
				});
				if (plList === null) continue;
				if (plList.elements[0].name == 'html') {
					// Did not get a media container. This happens if we are not authorized for the source..
					continue;
				}
				if (plList.elements[0].elements) {
					anyListFound = true;
					for (let i = 0; i < plList.elements[0].elements.length; i++) {
						let prefix = "";
						let isKind = 0; // 0 == unknown; 1 == Music; 2 == Video
						if (plList.elements[0].elements[i].attributes.playlistType == 'audio') {
							prefix = this.homey.__('labels.audio');
							isKind = 1;
						} else if (plList.elements[0].elements[i].attributes.playlistType == 'video') {
							prefix = this.homey.__('labels.video');
							isKind = 2;
						}
						playLists.push({
							name: `${prefix}${plList.elements[0].elements[i].attributes.title}`,
							description: `${this.homey.__('labels.server')}: ${this.homey.app.plexServers[isrv].name}`,
							url: plList.elements[0].elements[i].attributes.key,
							plKind: isKind,
							server: this.homey.app.plexServers[isrv]
						});
					}
				}
			}
		}
		if (anyOnline === false) throw new Error(this.homey.__('inAppErrors.noServer'));
		if (anyListFound === false) throw new Error(this.homey.__('inAppErrors.noPlaylists'));
		return playLists;
	}

	async StartPlayist(args) {
		let Shuffle = args.shuffle;
		this.homey.app.log('Used Playlist: ', args.playlist);
		let trigger_new_playlist = {
			'ccp_name': args.player.name,
			'playlist_name': args.playlist.name
		};
		this.homey.app.trigger_new_playlist_playing.trigger(trigger_new_playlist)
			.then(() => {
				// NOP
			})
			.catch(err => {
				this.homey.app.log(err);
			})
		let homey = this.homey;
		homey.app.getMP3s(args).then(medialist => {
			let playerError = "";
			for (let i = 0; i < homey.app.cc_list.length; i++) {
				if (homey.app.cc_list[i].id == args.player.id) {
					homey.app.log(homey.app.cc_list[i].name, 'Found items in list:', medialist.length);
					// Shuffle loaded list if requested..
					if (Shuffle == "REPEAT_ALL_AND_SHUFFLE") {
						homey.app.log(homey.app.cc_list[i].name, 'Shuffling items list..');
						medialist = homey.app.shuffle(medialist);
					}
					// create fresh client
					homey.app.cc_list[i].playerClient = new Client();
					// Remember playlist identification and settings..
					homey.app.cc_list[i].argsUsed = args;
					// Slice medialist into digestable segments and store it..
					homey.app.cc_list[i].medialistStore = [];
					homey.app.cc_list[i].medialistStoreCurrentIndex = 0;
					let trackLimitScan = 0;
					let trackLimitStoreSort = 0;
					homey.app.log(homey.app.cc_list[i].name, 'Preprocessing medialist..');
					for (let iTrack = 0; iTrack < medialist.length; iTrack++) {
						trackLimitScan++;
						if (homey.app.cc_list[i].medialistStore[trackLimitStoreSort] == null) homey.app.cc_list[i].medialistStore[trackLimitStoreSort] = [];
						homey.app.cc_list[i].medialistStore[trackLimitStoreSort].push(medialist[iTrack]);
						if (trackLimitScan == 100) {
							trackLimitStoreSort++;
							homey.app.log(homey.app.cc_list[i].name, 'Medialist new slice', trackLimitStoreSort);
							trackLimitScan = 0;
						}
					}
					homey.app.log(homey.app.cc_list[i].name, 'Preprocessing medialist finsihed. List been split into', homey.app.cc_list[i].medialistStore.length, 'segments.');
					// Connect the cast device and start playing..
					try {
						homey.app.cc_list[i].playerClient.connect(homey.app.cc_list[i], function () {
							homey.app.cc_list[i].playerClient.launch(DefaultMediaReceiver, function (err, player) {
								if (err) {
									homey.app.error(homey.app.cc_list[i].name, 'playerClient.launch Error:', util.inspect(err));
								}
								if (player === undefined) {
									homey.app.error(homey.app.cc_list[i].name, 'playerClient.launch player is not defined:', util.inspect(err));
									return;
								}
								player.on('status', gotStatus);
								function gotStatus(status) {
									//console.log('status broadcast = %s', util.inspect(status)," ");
									if (status.currentItemId) homey.app.log(homey.app.cc_list[i].name, 'Current Item ID:', status.currentItemId);
									homey.app.log(homey.app.cc_list[i].name, 'Status Update:', status.playerState);
									if (status.playerState == 'PLAYING')
										if (status.media)
											if (status.media.metadata) {
												if (status.media.metadata.title) {
													homey.app.log(homey.app.cc_list[i].name, 'Media Title:', status.media.metadata.title);
													let trigger_new_item_playing_tokens = {
														'ccp_name': args.player.name,
														'item_title': status.media.metadata.title
													};
													homey.app.trigger_new_item_playing.trigger(trigger_new_item_playing_tokens)
														.then(() => {
															// NOP
														})
														.catch(err => {
															homey.app.log(err);
														})
												}
												if (status.media.metadata.metadataType == 1) {
													let trigger_new_movie = {
														'ccp_name': args.player.name,
														'item_title': status.media.metadata.title,
														'orig_title': status.media.metadata.subtitle,
														'studio': status.media.metadata.studio
													};
													homey.app.trigger_new_movie_playing.trigger(trigger_new_movie)
														.then(() => {
															// NOP
														})
														.catch(err => {
															homey.app.log(err);
														})
												} else if (status.media.metadata.metadataType == 2) {
													let trigger_new_episode = {
														'ccp_name': args.player.name,
														'item_title': status.media.metadata.title,
														'series_title': status.media.metadata.seriesTitle,
														'season': status.media.metadata.season,
														'episode': status.media.metadata.episode
													};
													homey.app.trigger_new_episode_playing.trigger(trigger_new_episode)
														.then(() => {
															// NOP
														})
														.catch(err => {
															homey.app.log(err);
														})
												} else if (status.media.metadata.metadataType == 3) {
													let trigger_new_song = {
														'ccp_name': args.player.name,
														'item_title': status.media.metadata.title,
														'album': status.media.metadata.albumName,
														'artist': status.media.metadata.artist
													};
													if (status.media.metadata.title !== undefined) {
														homey.app.trigger_new_music_playing.trigger(trigger_new_song)
															.then(() => {
																// NOP
															})
															.catch(err => {
																homey.app.log(err);
															})
													}
												}
											}
									// Uncertain whether losing the playerClient is bad or not as the player keeps working it seems.
									if (homey.app.cc_list[i].playerClient == null) {
										homey.app.error(homey.app.cc_list[i].name, 'WARNING: playerClient was null on receiving playback status update!');
										//homey.app.log(homey.app.cc_list[i].name, 'homey.app.cc_list[i] was:', util.inspect(homey.app.cc_list[i]));
									}
									homey.app.cc_list[i].player = player;
									homey.app.cc_list[i].playerStatus = status;
									//console.log('Client = %s', util.inspect(homey.app.cc_list[i].playerClient));
									//console.log('Player = %s', util.inspect(player));
									if (
										status.idleReason == "FINISHED" &&
										status.loadingItemId === undefined) {
										homey.app.log(homey.app.cc_list[i].name, "Done!");
									}
								}
								// Queue items
								homey.app.log(homey.app.cc_list[i].name, "Queuing Items..");
								player.queueLoad(
									homey.app.cc_list[i].medialistStore[homey.app.cc_list[i].medialistStoreCurrentIndex],
									{
										//startIndex: homey.app.cc_list[i].medialistStore[homey.app.cc_list[i].medialistStoreCurrentIndex].length - 1,
										startIndex: 0,
										repeatMode: args.shuffle
									},
									function (err, status) {
										homey.app.log(homey.app.cc_list[i].name, "Queuing first items finished.");
										if (err) {
											homey.app.error(homey.app.cc_list[i].name, 'player.queueLoad:', util.inspect(err));
											return;
										} else {
											homey.app.loadQueueExt(homey.app.cc_list[i], homey);
										}
									}
								);
							});
						});
						// Error Handling
						homey.app.cc_list[i].playerClient.on('error', function (err) {
							homey.app.error(homey.app.cc_list[i].name, 'playerClient Error:', util.inspect(err));
							// playerClient can be null. Closing in that case crashes the app.
							//homey.app.cc_list[i].playerClient.close();
						});
						break;
					}
					catch (ex) {
						playerError = "Error initializing player: " + util.inspect(ex);
					}
				}
			}
			if (playerError != "") {
				homey.app.error(homey.app.cc_list[i].name, 'playerClient Initialization Error:', playerError);
				throw (playerError);
			}
			return Promise.resolve(true);
		})
			.catch(err => {
				return Promise.resolve(err);
			});
		return Promise.resolve(true);
	}

	loadQueueExt(cc_player, homey) {
		cc_player.medialistStoreCurrentIndex++;
		if (cc_player.medialistStoreCurrentIndex == cc_player.medialistStore.length) {
			// Last segement was qeueued already..
			homey.app.log(cc_player.name, 'Last segment has been queued.');
			return;
		} else {
			homey.app.log(cc_player.name, 'Inserting segment', cc_player.medialistStoreCurrentIndex, '..');
			cc_player.player.queueInsert(
				cc_player.medialistStore[cc_player.medialistStoreCurrentIndex],
				function (err, status) {
					if (err) {
						homey.app.error(util.inspect(err));
					} else {
						homey.app.log(cc_player.name, 'Inserted segment', cc_player.medialistStoreCurrentIndex);
						homey.app.loadQueueExt(cc_player, homey);
					}
				}
			);
		}
	}

	async onInit() {
		this.log('PlexPL2Cast is starting up..');
		this._logColor = (process.env.DEBUG === '1') ? true : false;
		let myUUID = this.homey.settings.get('plexUUID');
		if (myUUID == null) {
			this.log("No UUID, yet. Let's generate one..")
			myUUID = uuidv4();
			this.homey.settings.set('plexUUID', myUUID);
		}
		this.log("App UUID:", myUUID);

		// Init settings..
		// Cache available plex servers
		this.plexServers = [];

		// init chromecast scanner
		this.homey.app.cc_list = [];
		this.homey.app.mdns_scan(this.homey.app.newCastDevice, 60000, this.homey.app.updatedCastDevice);

		// register trigger cards
		this.homey.app.trigger_new_item_playing = this.homey.flow.getTriggerCard('new_item_playing');
		this.homey.app.trigger_new_music_playing = this.homey.flow.getTriggerCard('new_music_playing');
		this.homey.app.trigger_new_movie_playing = this.homey.flow.getTriggerCard('new_movie_playing');
		this.homey.app.trigger_new_episode_playing = this.homey.flow.getTriggerCard('new_episode_playing');
		this.homey.app.trigger_new_playlist_playing = this.homey.flow.getTriggerCard('new_playlist_playing');

		// register condition cards
		let condition_probe_status = this.homey.flow.getConditionCard('ccp_state_check');
		condition_probe_status
			.registerRunListener((args, state) => {
				let foundPlayer = null;
				for (let i = 0; i < this.homey.app.cc_list.length; i++) {
					if (this.homey.app.cc_list[i].id == args.player.id) {
						foundPlayer = this.homey.app.cc_list[i];
						break;
					}
				}
				let foundStatus = this.homey.app.getPlaybackStatus(foundPlayer);
				if (foundStatus == null) foundStatus = 'PLAYING';
				let result = args.probe_status == foundStatus;
				return Promise.resolve(result);
			});
		condition_probe_status.getArgument('player')
			.registerAutocompleteListener(async query => {
				let player = [];
				for (let i = 0; i < this.homey.app.cc_list.length; i++) {
					let entry = {
						name: `${(this.homey.app.cc_list[i].is_group) ? this.homey.__('driver.group') : ''}${this.homey.app.cc_list[i].name}`,
						description: this.homey.app.cc_list[i].description,
						id: this.homey.app.cc_list[i].id
					}
					player.push(entry);
				}
				return player;
			});

		// register action cards
		let play_card_v2 = this.homey.flow.getActionCard('play_plex_playlist_v2');
		play_card_v2.registerRunListener(async args => {
			return this.StartPlayist(args);
		})
			.getArgument('playlist')
			.registerAutocompleteListener(async query => {
				return this.homey.app.getAllPlaylists();
			});
		play_card_v2
			.getArgument('player')
			.registerAutocompleteListener(async query => {
				let player = [];
				for (let i = 0; i < this.homey.app.cc_list.length; i++) {
					let entry = {
						name: `${(this.homey.app.cc_list[i].is_group) ? this.homey.__('driver.group') : ''}${this.homey.app.cc_list[i].name}`,
						description: this.homey.app.cc_list[i].description,
						id: this.homey.app.cc_list[i].id
					}
					player.push(entry);
				}
				return player;
			});

		let play_card = this.homey.flow.getActionCard('play_plex_playlist');
		play_card.registerRunListener(async args => {
			return this.StartPlayist(args);
		})
			.getArgument('playlist')
			.registerAutocompleteListener(async query => {
				return this.homey.app.getAllPlaylists();
			});
		play_card
			.getArgument('player')
			.registerAutocompleteListener(async query => {
				let player = [];
				for (let i = 0; i < this.homey.app.cc_list.length; i++) {
					let entry = {
						name: `${(this.homey.app.cc_list[i].is_group) ? this.homey.__('driver.group') : ''}${this.homey.app.cc_list[i].name}`,
						description: this.homey.app.cc_list[i].description,
						id: this.homey.app.cc_list[i].id
					}
					player.push(entry);
				}
				return player;
			});

		let send_command = this.homey.flow.getActionCard('send_cc_command');
		send_command.registerRunListener(async args => {
			for (let i = 0; i < this.homey.app.cc_list.length; i++) {
				if (this.homey.app.cc_list[i].id == args.player.id) {
					// create fresh client
					if (this.homey.app.cc_list[i].player == null) {
						throw new Error(this.homey.__('inAppErrors.noClientError'));
					} else {
						if (args.command == "STOP") {
							this.homey.app.log('Command STOP:', args.player.name);
							this.homey.app.cc_list[i].player.stop();
						}
						if (args.command == "NEXT") {
							this.homey.app.log('Command NEXT:', args.player.name);
							this.homey.app.cc_list[i].player.next();
						}
						if (args.command == "PREV") {
							this.homey.app.log('Command PREV:', args.player.name);
							this.homey.app.cc_list[i].player.prev();
						}
						if (args.command == "PAUSE") {
							this.homey.app.log('Command PAUSE:', args.player.name);
							this.homey.app.cc_list[i].player.pause();
						}
						if (args.command == "PAUSE_OR_RESUME") {
							this.homey.app.log('Command PAUSE_OR_RESUME:', args.player.name);
							if (this.homey.app.cc_list[i].playerStatus.playerState == "PAUSED") {
								this.homey.app.cc_list[i].player.play();
							} else {
								this.homey.app.cc_list[i].player.pause();
							}
						}
						if (args.command == "PLAY") {
							this.homey.app.log('Command PLAY:', args.player.name);
							this.homey.app.cc_list[i].player.play();
						}
						if (args.command == "NEXT_PLAYLIST") {
							this.homey.app.log('Command NEXT_PLAYLIST:', args.player.name);
							let newArgs = this.homey.app.cc_list[i].argsUsed;
							this.homey.app.log('Command NEXT_PLAYLIST old list:', newArgs.playlist.name);
							newArgs.playlist = await this.homey.app.getSiblingPlaylist(this.homey.app.cc_list[i].argsUsed.playlist, 'next');
							this.homey.app.log('Command NEXT_PLAYLIST new list:', newArgs.playlist.name);
							this.StartPlayist(newArgs);
						}
						if (args.command == "PREV_PLAYLIST") {
							this.homey.app.log('Command PREV_PLAYLIST:', args.player.name);
							let newArgs = this.homey.app.cc_list[i].argsUsed;
							this.homey.app.log('Command NEXT_PLAYLIST old list:', newArgs.playlist.name);
							newArgs.playlist = await this.homey.app.getSiblingPlaylist(this.homey.app.cc_list[i].argsUsed.playlist, 'prev');
							this.homey.app.log('Command NEXT_PLAYLIST new list:', newArgs.playlist.name);
							this.StartPlayist(newArgs);
						}
					}
					//this.homey.app.cc_list[i].playerClient = new Client();
					break;
				}
			}
			return Promise.resolve(true);
		})
			.getArgument('player')
			.registerAutocompleteListener(async query => {
				let player = [];
				for (let i = 0; i < this.homey.app.cc_list.length; i++) {
					let entry = {
						name: `${(this.homey.app.cc_list[i].is_group) ? this.homey.__('driver.group') : ''}${this.homey.app.cc_list[i].name}`,
						description: this.homey.app.cc_list[i].description,
						id: this.homey.app.cc_list[i].id
					}
					player.push(entry);
				}
				return player;
			});

		// Send important update infos to timeline..
		if (this.homey.settings.get('updInfo_1_5_0') == null) {
			await this.sendMsgToTimeline(this.homey.__('updateInfos.1_5_0'));
			this.homey.settings.set('updInfo_1_5_0', true);
		}
		if (this.homey.settings.get('updInfo_common') == null) {
			await this.sendMsgToTimeline(this.homey.__('updateInfos.common'));
			this.homey.settings.set('updInfo_common', true);
		}
		this.log('PlexPL2Cast is now running.');
	} // onInit
}

module.exports = PlexPL2URL;
