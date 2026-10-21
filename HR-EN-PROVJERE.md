## HR / EN

Dodan je mali izbor HR / EN u zaglavlju. Hrvatski je zadani jezik. Engleski se može podijeliti na postojećoj adresi s `?lang=en`. Prevedeni su svi trenutačno objavljeni tekstovi, opisi slika, oznake, kontaktni predmet poruke i četiri komentara klijenata. Fotografije, video datoteke, naslovnice i njihove adrese nisu promijenjeni. Govor i tekst ugrađeni u same videozapise ostaju dio originalnih snimaka.

Prijevod je isključivo u pregledniku i ne koristi plaćeni servis za prevođenje niti dodatne API pozive pri prebacivanju. To nije automatski servis za prevođenje budućih novih tekstova: za novi ili izmijenjeni hrvatski tekst potrebno je dodati odgovarajući prijevod. Nepoznati tekst ne zamjenjuje se starim ili netočnim prijevodom.

Izvorni hrvatski HTML i atributi privremeno se čuvaju u memoriji preglednika i vraćaju pri odabiru HR. Objavljeni dokument, privatni nacrt, server, autentikacija, R2 preusmjeravanja, video player i migracije nisu mijenjani. Uređivanje `/uredi` ostaje hrvatsko. Dodatna zaštita pri snimanju nacrta čita hrvatski prikaz čak i ako je javna stranica trenutačno na engleskom.

Preglednik je provjeren na širinama 360, 390 i 1280 piksela. Provjere uspoređuju točno vraćanje hrvatskog HTML-a, fotografija, kontakata i komentara; potpunu pokrivenost prijevodom aktualnih tekstova; nedostatak novih video/API zahtjeva pri promjeni jezika; očuvanje izvora nepokrenutih videa u nacrtu; nepromijenjenu poziciju već odabranog videa; otvaranje galerije i prijevod dijaloga; hrvatsko privatno uređivanje čak i uz `?lang=en`; trajno spremanje samo hrvatskog nacrta. Ponovljene su provjere naslovnica, odgođenog učitavanja, osvježavanja i povratka preglednikom. Prošla su 42 postojeća Node testa.

Produkcijska provjera provjerava novu jezičnu skriptu, tipku EN, točno nepromijenjen objavljeni hrvatski dokument i postojeću isporuku svih pet videa izravno iz R2. Koriste se mali byte ranges; veliki videozapisi ne preuzimaju se ponovno.
