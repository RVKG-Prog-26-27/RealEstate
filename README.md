# Vai šo māju ir vērts pirkt? — Alpha versija

Rīks, kas novērtē, vai māju King County apgabalā (Sietla un apkārtne, ASV) ir izdevīgi nopirkt,
izremontēt un pārdot. Lietotājs atver sludinājumu Zillow vai Redfin, nospiež paplašinājuma ikonu
un dažās sekundēs redz:

- **verdiktu:** izdevīgi / uz robežas / neizdevīgi;
- **maksimālo izdevīgo cenu**, pie kuras pēc remonta un izmaksām paliek mērķa peļņa;
- **sagaidāmo peļņu un ROI**;
- tirgus vērtības novērtējumu un salīdzinājumu ar līdzīgiem darījumiem tuvumā.

Mājas parametrus (platība, istabas, būvgads, stāvoklis u. c.) lietotājam nav jāievada:
tos programma ņem no King County nekustamā īpašuma novērtētāja atvērtajiem datiem.

| | |
|---|---|
| **Mērķauditorija** | Māju pārpircēji un mazie nekustamo īpašumu investori King County |
| **Dati** | 128 262 reāli māju darījumi (2020-01 – 2026-09-22), 525 498 mājas |
| **Modelis** | Neironu tīkls (PyTorch), 168 ievades pazīmes |
| **Modeļa kvalitāte** | R² = 0,907; mediānā kļūda 8,2%; MAE $134 089 (pārbaude uz pēdējiem 12 mēnešiem) |
| **Saskarnes** | Chrome paplašinājums (bez servera), vietne, konsole |

---

## Saturs

1. [Palaišana](#palaišana)
2. [Funkcijas](#funkcijas)
3. [Kā tas strādā](#kā-tas-strādā)
4. [Projekta struktūra](#projekta-struktūra)
5. [Testēšana](#testēšana)
6. [Zināmās problēmas un ierobežojumi](#zināmās-problēmas-un-ierobežojumi)
7. [Komanda un ieguldījums](#komanda-un-ieguldījums)
8. [Datu avoti](#datu-avoti)

---

## Palaišana

Repozitorijā jau ir apmācīts modelis, datu kopa un sagatavoti paplašinājuma dati.
**Neko lejupielādēt vai apmācīt no jauna nav vajadzīgs.**

### 1. Chrome paplašinājums (ieteicamais veids, Python nav vajadzīgs)

1. Lejupielādējiet repozitoriju (**Code → Download ZIP**) un atarhivējiet.
2. Chrome atveriet `chrome://extensions`.
3. Augšējā labajā stūrī ieslēdziet **Developer mode** (izstrādātāja režīms).
4. Nospiediet **Load unpacked** un izvēlieties mapi `chrome_extension`
   (to, kurā ir `manifest.json` un mape `data`).
5. Piespraudiet ikonu: puzles ikona pie adreses joslas → spraudīte.

Lietošana: atveriet King County mājas sludinājumu Zillow vai Redfin → nospiediet mājiņas ikonu →
pārbaudiet ielasīto adresi un cenu → nospiediet **«Оценить дом»** (saskarne pagaidām ir krievu valodā).

> Mapi `chrome_extension` pēc instalēšanas nepārvietojiet un nedzēsiet: Chrome ielādē paplašinājumu
> tieši no tās. Brīdinājums par izstrādātāja režīma paplašinājumiem ir normāls.

### 2. Vietne (vajadzīgs Python 3.10+)

```bash
pip install -r requirements.txt
python run_project.py
```

Pārlūkā atvērsies `http://127.0.0.1:5000`. Ievadiet Zillow/Redfin/King County saiti,
zemes gabala numuru vai adresi, cenu un (pēc izvēles) remonta izmaksas.

### 3. Konsole

```bash
python evaluate.py 1702900205 --price 699k
python evaluate.py "3925 S Americus St, Seattle, WA 98118" --price 699000 --repair 40k
python evaluate.py          # interaktīvais režīms
```

### Datu atjaunināšana un modeļa pārapmācība

```bash
python scrape_king_county_real_sales.py   # lejupielādē ~200 MB novērtētāja datu
python train_house_ai.py                  # apmāca modeli
python export_extension.py                # pārnes modeli un datus paplašinājumā
```

Pēc eksporta `chrome://extensions` lapā pie paplašinājuma nospiediet ↻.
`python run_project.py --extension` izpilda visus vajadzīgos soļus un izlaiž jau paveiktos.

### Ja māja netiek atrasta

```bash
python diagnose.py "3925 S Americus St"
python diagnose.py 1702900205
```

Parāda, vai māja ir novērtētāja arhīvos, kā tā tur pierakstīta un vai tā nonāca uzziņu datos.
Vajadzīgs `king_residential.zip` projekta mapē (to lejupielādē `scrape_king_county_real_sales.py`).

---

## Funkcijas

| Funkcija | Paplašinājums | Vietne | Konsole |
|---|:-:|:-:|:-:|
| Mājas meklēšana pēc Zillow / Redfin saites | ✓ | ✓ | ✓ |
| Adreses, cenas un zemes gabala numura nolasīšana no sludinājuma lapas | ✓ | | |
| Meklēšana pēc King County saites, zemes gabala numura vai adreses | ✓ | ✓ | ✓ |
| Tirgus vērtības novērtējums ar neironu tīklu | ✓ | ✓ | ✓ |
| Piesardzīgais novērtējums (apakšējā ~10% robeža) | ✓ | ✓ | ✓ |
| Salīdzinājums ar līdzīgiem darījumiem tajā pašā ZIP pēdējos 12 mēnešos | ✓ | ✓ | ✓ |
| Verdikts, maksimālā izdevīgā cena, bezzaudējumu cena, peļņa, ROI | ✓ | ✓ | ✓ |
| Remonta izmaksu aptuvens novērtējums pēc mājas stāvokļa | ✓ | ✓ | ✓ |
| Brīdinājumi: nesen pārdota, vairākas dzīvojamās vienības, aizdomīgi zema cena, modelis nesakrīt ar tirgu | ✓ | ✓ | ✓ |
| Darījuma parametru maiņa (izmaksas, komisija, mērķa peļņa) | ✓ | `config.py` | `config.py` |
| Darbs bez interneta un servera | ✓ | | |

**Darījuma aprēķins** (noklusējuma vērtības `config.py`):

```
piesardzīgā vērtība = modeļa novērtējums − 1,28 × modeļa kļūdas standartnovirze
bezzaudējumu cena   = piesardzīgā vērtība − remonts − $30 000 − 8% pārdošanas izmaksas
maksimālā cena      = bezzaudējumu cena − 15% mērķa peļņa

cena ≤ maksimālā cena    → IZDEVĪGI
cena < bezzaudējumu cena → UZ ROBEŽAS
citādi                   → NEIZDEVĪGI
```

---

## Kā tas strādā

```
King County novērtētāja dati ──► scrape_king_county_real_sales.py
  (darījumi, ēkas, zemes gabali)        │
                                         ├─► king_county_real_house_sales.csv    (darījumi apmācībai)
                                         └─► king_county_houses_lookup_v2.csv.gz (visas mājas meklēšanai)
                                                     │
                       train_house_ai.py ◄───────────┘
                               │
                               └─► house_price_model.pt + house_preprocessor.joblib
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
        valuation.py (Python)                          export_extension.py
        vietne un konsole                                         │
                                                                  ▼
                                               chrome_extension/data + engine.js
                                               (tas pats aprēķins JavaScript valodā)
```

- **Modelis.** 26 skaitliskas pazīmes (platība, istabas, vannas istabas, būvgads, vecums,
  būvniecības klase, stāvoklis, zemes gabals, pagrabs, garāža, troksnis, skats uz ūdeni u. c.)
  un 5 kategorijas (ZIP, rajons, apkures sistēma un avots, izmantošanas veids) — kopā
  168 pazīmes pēc one-hot kodēšanas. Tīkls: 256 → 128 → 64 → 1 ar BatchNorm un Dropout;
  mērķis — cenas logaritms.
- **Pārbaude pēc laika.** Modelis mācās uz vecākiem darījumiem un tiek pārbaudīts uz pēdējiem
  12 mēnešiem — uz datiem, ko tas apmācībā nav redzējis. Galīgo modeli pēc tam apmāca uz visiem
  datiem ar atrasto epohu skaitu.
- **Paplašinājums bez servera.** `export_extension.py` iebūvē BatchNorm slāņus lineārajos slāņos
  un saglabā svarus JSON formātā; `engine.js` atkārto `valuation.py` loģiku. Dati sadalīti pa ZIP
  kodiem, tāpēc paplašinājums ielādē tikai vajadzīgo daļu (parasti 1–2 MB).

---

## Projekta struktūra

```
RealEstate/
├── README.md
├── requirements.txt
├── .gitignore
├── config.py                         # ceļi un darījuma parametri
│
├── scrape_king_county_real_sales.py  # 1. datu lejupielāde un tīrīšana
├── house_model.py                    #    kopīgās pazīmes un tīkla arhitektūra
├── train_house_ai.py                 # 2. modeļa apmācība un pārbaude
├── valuation.py                      # 3. meklēšana, novērtējums, salīdzinājums, atskaite
├── export_extension.py               # 4. modeļa un datu eksports paplašinājumam
│
├── run_project.py                    # visu soļu palaišana pēc kārtas
├── web_app.py                        # vietne (Flask)
├── templates/index.html              #   vietnes lapa
├── evaluate.py                       # konsoles saskarne
├── diagnose.py                       # palīgrīks: kāpēc māja netiek atrasta
│
├── chrome_extension/                 # Chrome paplašinājums
│   ├── manifest.json
│   ├── popup.html, popup.css         # logs
│   ├── popup.js                      # sludinājuma lapas nolasīšana, rezultāta attēlošana
│   ├── engine.js                     # novērtēšanas dzinējs (valuation.py JavaScript versija)
│   ├── icons/
│   └── data/                         # ģenerē export_extension.py
│
├── house_price_model.pt              # apmācītais modelis
├── house_preprocessor.joblib         # pazīmju apstrāde (scikit-learn)
├── king_county_real_house_sales.csv  # darījumi apmācībai
└── king_county_houses_lookup_v2.csv.gz  # visu māju uzziņu dati
```

Novērtētāja oriģinālie arhīvi (`king_*.zip`, līdz 147 MB) repozitorijā nav iekļauti
(`.gitignore`): GitHub nepieņem failus virs 100 MB, un skripts tos lejupielādē pats.

---

## Testēšana

Pārbaudes veiktas Alpha izstrādes laikā ar reāliem datiem un apmācīto modeli.
Paplašinājums pārbaudīts Chromium pārlūkā ar sludinājuma lapām Zillow formātā.

### Modeļa kvalitāte

| Pārbaude | Nosacījumi | Rezultāts |
|---|---|---|
| Precizitāte uz jauniem datiem | Apmācība uz darījumiem līdz 2025-09-22, pārbaude uz pēdējiem 12 mēnešiem | R² 0,907; mediānā kļūda 8,2%; MAE $134 089; log-RMSE 0,146 |
| Paplašinājums rēķina tāpat kā Python | 305 nejaušas mājas + 11 īpaši gadījumi, JavaScript pret Python | 316/316 sakrīt; maks. relatīvā atšķirība < 0,0001% |

### Mājas meklēšana

| Pārbaude | Nosacījumi | Rezultāts |
|---|---|---|
| Adreses trīs formātos | 2000 nejaušas reālas King County mājas: Zillow lapa, Zillow saite, Redfin saite | 1998 atrastas precīzi, 2 izvēles sarakstā (divas līdzīgas adreses), **0 nepareizu** |
| Centra ZIP ar maz privātmājām | Visas 40 mājas ZIP 98104, 98121, 98134 u. c. | 40/40 atrastas |
| Ātrums paplašinājumā | 3925 S Americus St, reāli dati | ~0,3 s |

### Normāli gadījumi

| # | Ievade | Sagaidāms | Rezultāts |
|---|---|---|---|
| N1 | Zillow lapa: 3925 S Americus St, cena $699 000 | Adrese, zemes gabala numurs un cena ielasās; verdikts | ✓ Neizdevīgi: maks. cena $499 869, bezzaudējumu $608 740 |
| N2 | Zemes gabala numurs `1702900205` | Māja atrasta | ✓ |
| N3 | `31617 40th Ave SW, Federal Way, WA, 98023` | Māja atrasta un novērtēta | ✓ |
| N4 | Mērķa peļņas maiņa paplašinājumā uz 5% | Verdikts pārrēķinās, iestatījums saglabājas | ✓ |

### Sarežģīti gadījumi

| # | Ievade | Sagaidāms | Rezultāts |
|---|---|---|---|
| S1 | `809 NE 48th St` un `809 N 48th St` | Dažādas mājas, nesajaukt | ✓ N atrasta, NE netiek aizstāta ar N |
| S2 | `3925 S Americus Ave` (datos ir St) | Nav atrasta | ✓ |
| S3 | Pilsēta ar ielas vārdu: Federal **Way**, **North** Bend | Pilsētu neuzskata par ielas daļu | ✓ (pirms labojuma netika atrastas) |
| S4 | `S Washington St`, `S Lane St` | Atrastas | ✓ (pirms labojuma netika atrastas) |
| S5 | Iela bez tipa saitē: `NW Esplanade` | Atrasta | ✓ |
| S6 | Māja ar 2 dzīvojamām vienībām (3925 S Americus St) | Atrasta + brīdinājums | ✓ |
| S7 | Māja bez ZIP novērtētāja datos | Atrasta; modelis izmanto biežāko ZIP | ✓ |
| S8 | Īsā Zillow saite bez adreses (`/homedetails/…_zpid/`) | Adrese tiek ņemta no lapas | ✓ |
| S9 | Robežpilsēta Milton (ZIP 98354) | Uzskatīta par King County | ✓ |

### Kļūdaini gadījumi

| # | Ievade | Sagaidāms | Rezultāts |
|---|---|---|---|
| K1 | `309 Foreman Rd, DuPont, WA 98327` (Pierce apgabals) | «ZIP 98327 nav King County» | ✓ |
| K2 | `1234 SE Main St, Portland, OR 97214` | «Nav King County», nevis līdzīga adrese King County | ✓ (pirms labojuma atrada citu māju) |
| K3 | Cita apgabala zemes gabala numurs + adrese no lapas | «Nav King County» | ✓ |
| K4 | `809 NE 48th St, Seattle 98105` (nav privātmāja) | «Nav privātmāju datubāzē» | ✓ |
| K5 | Lapa ar tipu «Condo» | «Modelis novērtē tikai privātmājas» | ✓ |
| K6 | Tukša cena, cena `abc`, tukšs mājas lauks | Skaidrs kļūdas paziņojums | ✓ |
| K7 | Paplašinājums bez mapes `data` | Norādījums palaist eksportu | ✓ |

### Testēšanas laikā atrastas un izlabotas kļūdas

| Kļūda | Kā atrasta | Labojums |
|---|---|---|
| Kategorijas `"5"` un `"5.0"` uzskatītas par dažādām, pazīme klusi pazuda | Koda pārskats | Kategoriju normalizācija `house_model.py` |
| Testa gads iekodēts (2025) | Koda pārskats | Pārbaude uz pēdējiem 12 mēnešiem |
| Mājas ar 2 dzīvojamām vienībām netika atrastas | Reāls sludinājums (3925 S Americus St) | Uzziņu datos visas dzīvojamās ēkas |
| `NE` un `N` ielas varēja sajaukt | Reāls sludinājums (809 NE 48th St) | Ielas virzienam un tipam jāsakrīt |
| Federal Way un North Bend mājas netika atrastas (atrasti tikai 95%) | Tests ar 2000 adresēm | Pilsētas nosaukums tiek atdalīts no ielas |
| Centra ZIP (98104, 98121) uzskatīti par «ne King County» | Reāls sludinājums | ZIP pārbaude pēc King County numerācijas |
| Portlendas adrese «atrasta» King County | Kļūdainu gadījumu tests | Svešs ZIP aptur meklēšanu |
| Mājai bez ZIP paplašinājums rēķināja citādi nekā Python (~0,1%) | JS pret Python salīdzinājums | Vienāda tukšā ZIP apstrāde |
| Vietne avarēja uz mājām bez ZIP | JS pret Python salīdzinājums | `pd.NA` apstrāde `valuation.py` |

---

## Zināmās problēmas un ierobežojumi

1. **Tikai King County privātmājas.** Dzīvokļi (condo), rindu mājas, daudzdzīvokļu mājas un mājas
   citos apgabalos netiek novērtētas — paplašinājums to skaidri pasaka.
2. **Novērtētāja dati var atpalikt no realitātes.** Piemēram, 3925 S Americus St datos ir
   1440 kv. pēdas un 2 guļamistabas, sludinājumā — 1920 kv. pēdas un 3. Pēc pārbūves vērtība
   var būt novērtēta par zemu. Salīdziniet mājas kartīti ar sludinājumu.
3. **Remonts tiek novērtēts aptuveni** pēc mājas stāvokļa ($3–80 par kv. pēdu). Ja zināt
   reālās izmaksas, ievadiet tās.
4. **Novērtējums ir uz pēdējā darījuma datumu datos (2026-09-22)**, bez tirgus prognozes.
5. **Mājas ar vairākām dzīvojamām vienībām** tiek novērtētas, bet modelis apmācīts uz
   vienas ģimenes mājām — tiek parādīts brīdinājums.
6. **Sludinājuma lapas nolasīšana** atkarīga no Zillow/Redfin lapu uzbūves. Ja tā mainīsies,
   adrese vai cena var neielasīties — tad tās jāievada ar roku.
7. **Robežas ZIP kodi** (piemēram, Snohomish apgabala daļa 980xx diapazonā) saņem paziņojumu
   «nav datubāzē», nevis «nav King County».
8. **Saskarne ir krievu valodā** (paplašinājums, vietne, konsole).
9. **Paplašinājums jāinstalē izstrādātāja režīmā**; datu apjoms ~115 MB.
10. **Testi nav automatizēti repozitorijā** — augstāk dokumentētās pārbaudes veiktas izstrādes laikā.
11. **Vajadzība nav pārbaudīta ar reāliem investoriem** — tas ir nākamā posma uzdevums.

**Nākamie soļi:** dzīvokļu (condo) datu pievienošana; iespēja labot platību un istabas;
remonta kalkulators pa darbiem. Pirmā uzlabojuma pārbaude: pareizi novērtēt vismaz 45 no 50
nejauši izvēlētiem King County dzīvokļu sludinājumiem.

---

## Komanda un ieguldījums

| Dalībnieks | Atbildība | Galvenie faili |
|---|---|---|
| Jegors Moskvins | Dati un modeļa apmācība | `scrape_king_county_real_sales.py`, `train_house_ai.py`, `house_model.py` |
| Jegors Moskvins | Chrome paplašinājums un meklēšana | `chrome_extension/`, `export_extension.py` |
| Jegors Moskvins | Vietne, novērtēšana, testēšana | `web_app.py`, `templates/`, `valuation.py` |

Katra dalībnieka darbs redzams commit vēsturē.

---

## Datu avoti

King County Department of Assessments atvērtie dati
([lejupielāde](https://aqua.kingcounty.gov/extranet/assessor/)):
*Real Property Sales*, *Residential Building*, *Parcel*.
Apmācībai izmantoti tikai parasti tirgus darījumi: bez brīdinājumiem, $100 000 – $5 000 000, no 2020. gada.

Šis rīks nav finanšu konsultācija: tas sniedz aptuvenu novērtējumu, kas jāpārbauda pirms darījuma.
