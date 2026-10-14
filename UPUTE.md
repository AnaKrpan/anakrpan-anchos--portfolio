# ANCHOS — Ana Krpan

Portfolio s javnom objavom i privatnim uređivanjem, pripremljen za Netlify.

## Prvo postavljanje

1. U Netlifyju odaberi besplatni plan Free i ovaj GitHub projekt.
2. Naziv projekta: `anchos-ana-krpan` ako je dostupan.
3. Base directory ostavi prazno. Build command: `npm run build`. Publish directory: `public`.
4. U Environment variables dodaj `PORTFOLIO_PASSWORD`. Vrijednost neka bude duga, jedinstvena lozinka od najmanje 16 znakova. Upisuje se isključivo u Netlify, nikad u ovaj javni projekt ili razgovor. Lozinka se ne ugrađuje u HTML. Ako su ponuđeni opsezi, uključi Functions. Nemoj postavljati produkcijsku lozinku u Deploy Previews.
5. Objavi projekt. Sačuvaj adresu koju Netlify prikaže. Buduće objave u istom projektu zadržavaju tu adresu.

## Svakodnevno uređivanje

- Otvori svoj javni portfolio i na dnu klikni „Prijava za uređivanje”.
- Upiši svoju lozinku. Prijava vrijedi osam sati.
- Klikni tekst za promjenu, fotografiju za zamjenu ili „Dodaj ili zamijeni video”.
- Pričekaj da datoteka bude učitana. Pri kratkom prekidu veze dio se pokušava prenijeti ponovno, a datoteke čekaju svoj red. Video se prenosi u dijelovima od 512 KB, bez ugrađivanja u HTML. Podržana su videa do 512 MB; za reprodukciju na različitim mobitelima koristi MP4 s H.264 videom i AAC zvukom.
- Nacrt se sprema privatno na Netlify, s provjerom sukoba ako je otvoreno više kartica.
- Klikni „Spremi i objavi”. Tek tada posjetitelji na istom javnom linku vide novi sadržaj.
- „Pogledaj objavljeni portfolio” otvara javnu verziju. „Odjavi se” zaključava uređivanje na tvom uređaju.

Ako se pojavi greška pri spremanju, ostavi karticu otvorenu i pokušaj ponovno. Stara objavljena verzija ostaje dostupna. Odjavljeni posjetitelji nemaju pristup nacrtu ni neobjavljenim datotekama. Sam javni link nije lozinka i možeš ga slobodno slati brendovima.

## Sadržaj i trajna pohrana

Sačuvani su posljednji dostavljeni tekstovi, tri izvorne portretne fotografije, pet mjesta za videe i sekcija brendova/komentara. Četiri fotografije galerije privremeni su izresci posljednje snimke ekrana, jer izvorne datoteke nisu dostavljene; možeš ih zamijeniti vlastitim izvornim fotografijama. Videi iz lokalne datoteke nisu bili ugrađeni u dostavljeni HTML; dodaješ ih ručno na objavljenoj stranici.

Podaci i dijelovi datoteka spremaju se u site-wide Netlify Blobs store `anchos-portfolio-v1`. Nova objava koda ne briše taj sadržaj. Ne briši Netlify projekt ni njegove Blobs podatke. U Netlify Data & Storage → Blobs možeš preuzeti pohranjene podatke za sigurnosnu kopiju. Dijelovi videa pohranjeni su odvojeno i pripadaju njihovom manifestu.

Free plan ima mjesečno ograničenje potrošnje, uključujući promet videa. Kad se besplatna kvota potroši, Netlify može pauzirati stranicu do obnove kvote. Veliki videi i velik broj pregleda mogu brzo potrošiti kvotu. Ovo nije obećanje neograničenog ili vječnog besplatnog hostinga.

## Provjera

`npm test` provjerava odvojeni javni sadržaj/nacrt, zaključavanje uređivanja, sesije, sukobe verzija, objavu, chunk upload i raspon bajtova za video. Testovi koriste memorijsku zamjenu za Netlify Blobs; produkcijska objava i stvarna reprodukcija na mobitelu provjeravaju se nakon Netlify deploya.
