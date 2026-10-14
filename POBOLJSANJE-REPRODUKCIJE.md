# Originalna kvaliteta, brže pokretanje i pouzdaniji mobilni prijenos

Stvarno provjerena HERBOXA datoteka ima 135.400.217 bajtova i SHA-256 `88c303a242ff95d2a78851ae798e3944cf17a9a1265d50223fbf0a7a444c93be`, identičan ranijem originalu. Svih 1.363 video kadrova dekodira se bez greške. To ne dokazuje glatko gledanje na mobitelu.

Tri trenutačno javna videa imaju MP4 metapodatke na kraju. Promjena priprema zasebnu lossless fast-start kopiju: metapodaci se premještaju ispred medijskih podataka i popravljaju se stco/co64 adrese. Ne postoji encoder niti promjena kadrova, zvuka, rezolucije ili bitratea. Ukupna veličina ostaje ista. Izvorna R2 datoteka, njena kontrolna suma, postojeći Blob dijelovi, dizajn i dokumenti se zadržavaju. `?original=1` na postojećem media URL-u uvijek bira izvorni R2 objekt.

Prvi dio kopije sastavlja se u ograničenoj memoriji pozadinske Node funkcije. Ostale dijelove kopira R2 sam preko UploadPartCopy, bez prebacivanja cijele datoteke kroz Edge funkciju ili lokalni disk. Prije promjene pokazivača ponovno se čitaju očekivani raspored i cijela kopija, pa se uspoređuju puni SHA-256. Kopiranje koje ne uspije ne zamjenjuje original. Netočan, fragmentiran ili već optimiziran MP4 ostaje na originalnoj dostavi; postupak ne pokušava naslijepo prepisivati nepoznate strukture.

Za originalne videe koji su javno objavljeni, potpis vrijedi šest sati, kako pauzirani player ne bi ostao bez slike zbog isteka kratkog potpisa. Neobjavljeni videi i dalje trebaju vlasničku sesiju za dobivanje potpisa koji vrijedi 30 minuta. Prenosni URL-ovi pojedinih dijelova i dalje su kratkotrajni.

Mobilni upload sada šalje baš isti ArrayBuffer koji je prethodno provjeren kontrolnom sumom, bez drugog čitanja istog File/Blob dijela. XHR prikazuje stvarni napredak i resetira rok mirovanja dok novi bajtovi stižu, umjesto da aktivan prijenos prekida nakon fiksne tri minute. Zadržan je krajnji rok po pokušaju i ponovno slanje samo nepotvrđenog dijela. Nedovršeni stari Edge prijenosi prelaze u novu izravnu pohranu; svi stari dijelovi ostaju sačuvani, ali njihovo djelomično slanje ne može se automatski nastaviti u drugom multipart rasporedu. Potpuno spremljeni postojeći video vraća se odmah bez ponovnog prijenosa.

Neuspjeli video zadržava svoju poruku greške i spremljeni nacrt ga ne predstavlja kao uspješno učitanog. Vidljivi videi mogu unaprijed učitati metapodatke; pri reprodukciji ostali se pauziraju. HTML, stilovi, fotografije i početni dokument ostaju isti.

Ograničenja: fast-start ne smanjuje 4K bitrate. Za original od 156 Mbit/s i dalje treba dovoljno brza veza ili čekanje da se podaci učitaju. Kopije zauzimaju dodatnu R2 pohranu približno jednaku veličini pripremljenih originala; postojeće datoteke se ne brišu. R2 ima naplatu iznad svoje uključene kvote. Puni prijenos velikog videa s korisničina mobitela i dovršetak stvarnih pozadinskih priprema ostaju zasebne provjere.
