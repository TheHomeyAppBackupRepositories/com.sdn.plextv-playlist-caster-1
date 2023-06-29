Unterstützte Sprachen
🇬🇧 English
🇩🇪 Deutsch

Einrichtung
Füge mindestens einen Plex Media Server (Wiedergabelisten Provider) als Gerät hinzu.
Der Einbindungsprozess wird nach dem Plex Konto Login fragen falls nötig.
Die Logindaten werden nicht gespeichert, sie dienen nur dazu die App als Gerät im Plex Konto hinzuzufügen.

Nutzung
Nutze FlowCards um die Wiedergabe der Wiedergabelisten auf Chromecast Geräten oder Gruppen zu steuern. Kompatible cast Geräte werden automatisch erkannt.
Die FlowCards listen alle gefundenen Wiedergabelisten aller Server die hinzugefügt wurden.

Fehlerbehebung
Problem: Du hast versehentlich die App aus deinem Plex Konto entfernt.
Lösung: Gehe in die App Einstellungen und logge dich manuell erneut in dein Plex Konto ein.
Problem: Du möchtest keine Server pollen die generell von Homey aus nicht erreichbar sind.
Lösung: Gehe in die App Einstellungen und setzte die betreffenden Server auf ignoriert.
Problem: Ein Server wird als online angezeigt aber die Anzahl der Playlisten steht auf 0.
Lösung: Gehe in die App Einstellungen und logge dich manuell erneut in dein Plex Konto ein.

API
Wenn der API Zugriff aktiviert wurde können andere Apps über die API Zugriff auf die Wiedergabelisten Informationen nehmen.
Die API Endpunkte erfordern eine gültige Homey Benutzersitzung.
Alle Wiedergabelisten: /getPlaylists
Elemente einer Wiedergabeliste: /getPlaylist?playlist=[urlAsReturnedByGetPlaylists]&server=[srvValueAsReturnedByGetPlaylists]
Schlägt eine Anfrage an die API fehl wird ein json Objekt mit dem Wert 'error' gesetzt zurückgegeben.

Einschränkungen
 - Kann nur Elemente abspielen deren Format vom gewählten cast Gerät nativ unterstützt werden.
 - Es ist kein Player Gerät in der Homey Benutzeroberfläche verfügbar. Dies begründet sich dadurch das es aktuell nicht möglich ist dynamisch befüllte Auswahllisten bereit zu stellen.
 - Das Abspielen einer Wiedergabeliste schlägt fehl wenn diese nur 1 Element enthält.

Bitte besuche die Plex Media Server Playlist Caster Seite im Athom Community Forum für weitere Informationen. Klicke auf Forum besuchen unter Community im untenstehenden Info Block.
