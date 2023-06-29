'use strict';

const Homey = require('homey');
// Devices are currently not used, see readme.
class CCPP_Device extends Homey.Device {

	onInit() {
		this.log('CCPP Device starting..');
		this.log('Name:', this.getName());
		this.log('Class:', this.getClass());
	}//onInit
}

module.exports = CCPP_Device;
