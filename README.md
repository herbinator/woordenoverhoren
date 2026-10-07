# Woorden overhoren

Een kleine web-app (PWA) om Franse woordjes te overhoren vanaf foto's uit het lesboek.
Hij werkt op Android en op een laptop, zonder appstore, en daarna ook offline.

## Wat kan de app

- Woordenlijsten maken per hoofdstuk of blok:
  - **Foto scannen**: de app leest de woorden van de foto (tekstherkenning in de browser, met Tesseract.js).
  - **Tekst plakken**: bijvoorbeeld het antwoord van een AI-chat. Je kunt ook zelf typen, één regel per woord: `l'école = de school`.
- **Leren** in rondes van 5 woorden: eerst kaartjes bekijken (met uitspraak), dan meerkeuze in beide richtingen en daarna zelf het Frans intypen, met de eerste letter als hulp. Wat niet lukt, komt in dezelfde ronde nog een keer terug. Het intypen kun je met een vinkje overslaan.
- Na het opslaan van een lijst kies je meteen: leren of overhoren.
- Een overhoring van 20 vragen: 10 Frans → Nederlands en 10 Nederlands → Frans.
- Antwoorden intypen of kiezen (meerkeuze). Accenten vergeten telt als goed, met een waarschuwing. Bij Nederlandse antwoorden is het lidwoord niet verplicht.
- De app onthoudt welke woorden je al kent: 3 keer achter elkaar goed. Woorden die je nog niet kent, krijg je vaker.
- Franse uitspraak via de luidsprekerknop.
- Lijsten exporteren en importeren om ze naar een ander apparaat over te zetten.

## Tips voor scannen

- Fotografeer het boek plat, recht van boven en met goed licht.
- Sleep een kader om één blok woorden en scan de blokken los. Dat geeft veel betere resultaten dan een hele pagina tegelijk, zeker bij een gebogen of scheve foto. Na het scannen blijft de foto open, zodat je meteen het volgende blok kunt doen.
- Bij een lastige foto doet de app automatisch een tweede poging met een andere instelling en houdt het beste resultaat. Dat duurt wat langer.
- Controleer de lijst na het scannen. Gele vakjes zijn nog leeg. Daaronder zie je een uitsnede van die regel uit de foto, zodat je het woord kunt overtypen. Tik in een rij om ook bij andere woorden de uitsnede te zien. De uitsnedes worden niet opgeslagen.
- Woorden die met pen onderstreept of overgeschreven zijn, komen vaak niet goed uit de scan.
- De eerste keer scannen heb je internet nodig: de app downloadt dan zo'n 10 tot 15 MB aan herkenningsbestanden. Daarna worden die bewaard.

## Online zetten met GitHub Pages

1. Maak op github.com een nieuwe **public** repository, bijvoorbeeld `woordenoverhoren`.
2. Upload de bestanden uit deze map. Upload **geen** foto's uit het boek; `.gitignore` houdt die al tegen.
3. Ga naar Settings → Pages. Kies bij "Branch" `main` en `/ (root)`, en klik op Save.
4. Na een minuut staat de app op `https://<jouw-gebruikersnaam>.github.io/woordenoverhoren/`.

## Installeren

- **Android**: open de link in Chrome, tik op het menu (⋮) en kies "App installeren" of "Toevoegen aan startscherm".
- **Laptop**: open de link in Chrome of Edge en klik op het installatie-icoontje rechts in de adresbalk.

## Nieuwe versie uitbrengen

Pas na een wijziging `CACHE` in `sw.js` aan (bijv. `woordenoverhoren-v2`) en `VERSION` in `app.js`. Daarna halen geïnstalleerde apps de update vanzelf op. Dat gebeurt bij de volgende keer openen, of de keer daarna.

## Lokaal testen

```
python -m http.server 8080     # daarna http://localhost:8080
node --test tests/             # tests voor de logica
```
