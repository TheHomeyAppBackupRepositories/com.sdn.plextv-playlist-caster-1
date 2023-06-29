Supported Languages
🇬🇧 English
🇩🇪 Deutsch

Setup
Add at least one Plex Media Server (Playlist Provider) device.
The pairing process will prompt for you Plex Account credentials if required.
Your credentials are not saved, they are used to register this app as a device in your plex account only.

Usage
Use flowcards to control playback of your playlists on Chromecast devices or groups. Compatible cast devices are detected automatically.
The cast to device card will provide you with a full list of all playlists found on all servers you have added.

Troubleshooting
Problem: You accidently removed the Homey app from your Plex Account.
Solution: Go into app settings and manually reauthenticate your Plex Account.
Problem: You want to avoid polling Plex Servers on your account which are not reachable by Homey at all.
Solution: Go into app settings and set that server to be ignored.
Problem: A server is shown as online but the playlist count is 0.
Solution: Go into app settings and reauthenticate your Plex Account.

API
If enabled in the app settings, other apps can consume the playlist api. The api endpoints require authentication.
All playlists: /getPlaylists
Items of a playlist: /getPlaylist?playlist=[urlAsReturnedByGetPlaylists]&server=[srvValueAsReturnedByGetPlaylists]
If the request fails a json object containing the 'error' is returned.

Limitations
 - Can only play files which are natively supported by the targeted casting device.
 - No player device in Homey UI. This is because currently it is not possible to add a playlist selector to Homey device UIs.
 - Playing a playlist will fail if the playlist contains 1 item only.

Please visit the Plex Media Server Playlist Caster topic on the Athom Community Forum for more information. Click on Visit Forum under Community in the app info block below.
