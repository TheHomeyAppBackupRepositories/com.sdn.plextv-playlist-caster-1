'use strict';

const Homey = require('homey');
// Devices are currently not used, see readme.
class CCPP_LAN_Driver extends Homey.Driver {
	onInit() {
		this.log("Starting driver..");
		this.log("Driver is up.");
	}
	onPairListDevices( data, callback ) {
		let devices = [];
		for (let i = 0; i < Homey.app.cc_list.length; i++) {
			// Optional properties, these overwrite those specified in app.json:
			// "name": "My Device",
			// "icon": "/my_icon.svg", // relative to: /drivers/<driver_id>/assets/
			// "capabilities": [ "onoff", "dim" ],
			// "capabilitiesOptions: { "onoff": {} },
			// Optional properties, device-specific:
			// "store": { "foo": "bar" },
			// "settings": { "my_setting": "my_value" },
			let entry = {
				"data": { "id": Homey.app.cc_list[i].id },
				"name": `${(Homey.app.cc_list[i].is_group) ? Homey.__('driver.group') : ''}${Homey.app.cc_list[i].name}`,
			}
			devices.push(entry);
		}
		callback( null, devices );
	}
}

module.exports = CCPP_LAN_Driver;
