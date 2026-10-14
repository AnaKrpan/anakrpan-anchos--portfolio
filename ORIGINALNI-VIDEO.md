# Originalni videi uz identičan portfolio

Status: pripremljeno i lokalno provjereno; nije aktivirano na produkciji. Stvarna R2 pohrana još nije povezana. Ne tvrditi da je reprodukcija već popravljena.

## Što je sačuvano

Produkcijski kôd i kompletan dizajn sačuvani su na grani `preserve-original-videos`, iz glavne verzije `689a9b7eff5f5c3a46c528334a15e787a754cb8a`. Ova promjena ne uređuje HTML, CSS, fotografije ni početni dokument. Postojeći objavljeni dokument i privatni nacrt ne zamjenjuju se.

Dovršena je javna sigurnosna kopija: dva videozapisa, sedam fotografija i snimka objavljenog dokumenta. GitHub arhiva: https://github.com/AnaKrpan/anakrpan-anchos--portfolio/actions/runs/38581650795/artifacts/11904406370

Arhiva ima 957.416.943 bajta. Istječe 12. siječnja 2027.; za trajno čuvanje treba je preuzeti. Izvorne datoteke na Netlifyju nisu izbrisane. Arhiva ne uključuje privatne nacrte niti nezavršena učitavanja, jer ova javna provjera nema vlasničku sesiju.

Izvorni SHA-256:
- FLOVA, 820.728.899 bajtova: `16b40636f8624103529afe6f27fb9919dc7194e234a48455659d03ce91f6e4f4`
- HERBOXA, 135.400.217 bajtova: `88c303a242ff95d2a78851ae798e3944cf17a9a1265d50223fbf0a7a444c93be`

## Način rada

Netlify ostaje domaćin portfolija na istom javnom linku. Tekstovi, fotografije i postojeći privatni način uređivanja ostaju u postojećoj pohrani. Samo videozapisi mogu koristiti privatni Cloudflare R2 spremnik.

Novi originalni video šalje se izravno iz preglednika u R2 putem vremenski ograničenih, potpisanih dozvola za pojedini dio. Ključevi pohrane ostaju na serveru. Svaki dio ima Content-MD5 kontrolni zbroj koji je vezan uz potpis zahtjeva. Pohrana mora potvrditi dijelove i točnu veličinu završene datoteke. Napredak se može pronaći u pohrani i bez lokalnih podataka preglednika. Nema ponovnog kodiranja, kompresije ni promjene piksela.

Javni putovi `/media/<id>.mp4` ostaju isti. Server najprije provjerava je li video objavljen ili je vlasnica prijavljena. Zatim preglednik preusmjerava na privremeni URL originalne datoteke s podrškom za byte ranges. Bajtovi za reprodukciju više se ne spajaju kroz Netlify Edge. Ovdje se ne tvrdi da su privatni S3 URL-ovi javni CDN cache.

Prijenos postojećih videa radi u pozadinskoj Node funkciji, ne u Edge funkciji. Kopira samo originalne bajtove iz postojeće pohrane u R2. Zatim ponovno čita cijelu kopiju i uspoređuje puni SHA-256 prije promjene pokazivača. Objavljeni dokument i privatni nacrt ostaju nepromijenjeni. Prije prijenosa arhivira se i privatna snimka stanja u postojećem privatnom Blob spremniku.

Stari video dijelovi i izvorni manifest trajno se zadržavaju u ovom postupku. Ako kopiranje ili provjera ne uspiju, stari manifest se ne zamjenjuje. Uspješna migracija čuva originalni manifest za povratak na staru dostavu. Postupak ništa ne briše. Nedovršena stara učitavanja nastavljaju koristiti prethodni protokol do završetka.

## Povezivanje i provjera prije aktivacije

1. Otvoriti Cloudflare račun i pregledati R2 uvjete naplate. Ne obećavati neograničeno besplatno korištenje. Trenutačna Standard kvota uključuje 10 GB-mjesečno, milijun Class A i deset milijuna Class B operacija; izlazni promet se ne naplaćuje, ali korištenje iznad kvota jest. https://developers.cloudflare.com/r2/pricing/ i https://developers.cloudflare.com/r2/get-started/
2. Napraviti privatni Standard R2 spremnik `anchos-originals`. Ne uključivati javni `r2.dev` pristup. Ne postavljati automatsko brisanje originala.
3. Napraviti R2 S3 pristupne ključeve ograničene na čitanje/pisanje samo tog spremnika. Tajne unijeti izravno u Netlify postavke; ne slati ih u chat niti spremati u GitHub kôd.
4. Za pregled i produkciju postaviti `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` i `ORIGINAL_VIDEO_STORAGE=r2`. Ključevi trebaju biti dostupni i Edge i Functions runtimeu. Postojeći `PORTFOLIO_PASSWORD` ostaje isti. Ostaviti `ORIGINAL_VIDEO_MIGRATION` isključenim u svim probnim kontekstima.
5. Postaviti CORS na spremniku samo za stvarni javni i odobreni probni Netlify origin: metode GET, HEAD, PUT; zaglavlja Content-Type, Range, Content-MD5; izložena zaglavlja ETag, Content-Range, Accept-Ranges, Content-Length i x-amz-checksum-sha256. Predložak je u `config/r2-cors.json`. Probni origin treba dodati izričito, ne wildcard.
6. Prvo provjeriti stvarne S3 API pozive, Content-MD5-potpisani upload, nastavak nakon prekida, gubitak završne potvrde i byte-range čitanje na probnoj datoteci. `scripts/verify-original-storage.mjs` koristi izolirani privremeni objekt, provjerava cijeli SHA-256 i stvarni HTTP Range. Taj objekt nije video korisnice; skripta ga ne briše automatski. Ovaj korak još nije izvršen bez pohrane.
7. Prije glavne objave usporediti izgled i objavljeni dokument s postojećom verzijom. Pri probnom uređivanju ne mijenjati postojeći nacrt jer je Blob spremnik na razini web projekta.
8. Tek nakon uspješnog testa povezane pohrane objaviti kôd na glavnoj grani i potvrditi ispravno ponašanje na istom javnom linku. Migracija se prema zadanim postavkama pokreće samo na postojećem produkcijskom hostu, kada je R2 povezan; na probnoj verziji ostaje isključena. Za izričito zaustavljanje postaviti `ORIGINAL_VIDEO_MIGRATION=disabled`. Kada vlasnica otvori `/uredi`, kopiranje kreće u pozadini. Ponovno otvaranje može nastaviti nedovršeno kopiranje.
9. Provjeriti puni SHA-256 migriranih stvarnih videa, cjelovitu reprodukciju i traženje mjesta u videu na mobitelu. Tek tada izvijestiti da nova dostava radi. Za povratak, isključiti `ORIGINAL_VIDEO_STORAGE` i migraciju: migrirani originali imaju stari manifest, a novi R2 originali nisu dostupni bez povezanih R2 ključeva; zato ne uklanjati ključeve nakon prvog novog videa bez prethodne kopije.

## Granice

Najveći original u ovoj aplikaciji i dalje je 2 GiB po datoteci. Original od oko 156 Mbit/s i dalje zahtijeva dovoljno brzu vezu te uređaj koji dekodira 4K/60. Izravna dostava uklanja sadašnje spajanje stotina dijelova kroz Edge, ali nije jamstvo glatke reprodukcije na svakoj vezi. MP4 metapodaci u oba postojeća originala su na kraju; R2 range čitanje podržava taj položaj bez promjene datoteke.

R2 nije povezan u ovoj sesiji: nema računa, spremnika niti runtime pristupnih ključeva. Netlify preview, stvarni upload u R2 i stvarno gledanje originala još nisu provjereni. Privatni nacrt i nezavršena učitavanja ne mogu se javno preuzeti; postojeći spremnik se čuva i privatna arhiva stanja pravi se pri autoriziranoj migraciji.


## Provjera stvarnog R2 prijenosa, 14. listopada

Vlasnička probna provjera vratila je HTTP 501 pri UploadPart zahtjevu s x-amz-checksum-sha256. Multipart započinjanje prošlo je, a dio nije prihvaćen. Promjena koristi izričito podržani Content-MD5 vezan uz potpis; potpuna SHA-256 usporedba migriranih originala ostaje. Potrebno je dodati Content-MD5 u AllowedHeaders R2 CORS pravila prije izravnog prijenosa iz preglednika. Ni ova pogreška ni provjera nisu mijenjale postojeće originale ili dokumente. Stvarna ponovljena provjera još treba uspjeti.


## Završna provjera na mobitelu

Vlasnica je uspješno provjerila stvarni R2 prijenos i puni checksum probne datoteke nakon promjene na Content-MD5 te spremila CORS pravilo s Content-MD5 za javni i probni origin. Stranica provjera-pohrane.html sada automatski pokreće test stvarnim browser uploaderom: 8 MiB + 97 bajtova, dva multipart dijela, izravni CORS PUT, ponovno čitanje cijelog sadržaja, SHA-256 i Range preko granice dijela. Datoteka se ne dodaje u javni ni privatni dokument. Aktivacija na glavnoj grani još čeka uspješan ishod ove provjere.
