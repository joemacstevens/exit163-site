# Exit 163 source registry

363 sources we re-check for Bergen County events. Built by `scripts/build-registry.py` from the scout files in this folder; edit those, then rebuild.

| | count |
|---|---|
| **By domain** | family-community 165, food-active-culture 76, music-comedy-arts 70, nightlife 62 |
| **By access** | open 271, js_heavy 41, login_required 41, blocked 10 |
| **By yield** | low 171, medium 131, high 61 |
| **By re-check cadence** | monthly 169, weekly 131, seasonal 35, biweekly 28 |

## High-yield sources

| source | kind | towns | access | cadence | page to re-check |
|---|---|---|---|---|---|
| BCCLS shared LibCal (all Bergen library event calendars) | library | Bergen County | open | weekly | https://bccls.libcal.com/ |
| Bergen Mama weekly 'Things to Do in Bergen County' | aggregator | Bergen County | blocked | weekly | https://bergenmama.com/things-to-do |
| Bergenfield Public Library | library | Bergenfield | open | weekly | https://bccls.libcal.com/calendar/bergenfield |
| Demarest Public Library | library | Demarest | open | weekly | https://bccls.libcal.com/calendar/demarest |
| Dixon Homestead Library | library | Dumont | open | weekly | https://bccls.libcal.com/calendar/dumont |
| Emerson Public Library | library | Emerson | open | weekly | https://bccls.libcal.com/calendar/emerson |
| Englewood Public Library | library | Englewood | open | weekly | https://bccls.libcal.com/calendar/englewood |
| Fair Lawn's Maurice M. Pine Public Library | library | Fair Lawn | open | weekly | https://bccls.libcal.com/calendar/fairlawn |
| Fort Lee Public Library events | library | Fort Lee | open | weekly | https://fortlee.librarycalendar.com/events/upcoming |
| Franklin Lakes municipal calendar | town_calendar | Franklin Lakes | open | monthly | https://www.franklinlakes.org/communityevents |
| Hackensack's Johnson Public Library | library | Hackensack | open | weekly | https://bccls.libcal.com/calendar/hackensack |
| Haworth Municipal Library | library | Haworth | open | weekly | https://bccls.libcal.com/calendar/haworth |
| Hillsdale Free Public Library | library | Hillsdale | open | weekly | https://bccls.libcal.com/calendar/hillsdale |
| Kaplen JCC on the Palisades events | community_org | Tenafly | open | weekly | https://www.jccotp.org/wp-json/tribe/events/v1/events |
| Leonia Public Library | library | Leonia | open | weekly | https://bccls.libcal.com/calendar/leonia |
| Macaroni KID N Pascack Valley | aggregator | Washington Township, River Vale, Hillsdale… | open | weekly | https://npascackvalley.macaronikid.com/events |
| Macaroni KID Northwest Bergen (Ramsey edition) | aggregator | Ramsey, Upper Saddle River, Allendale… | open | weekly | https://ramsey.macaronikid.com/events |
| Macaroni KID Paramus - Tenafly | aggregator | Paramus, Tenafly, Hackensack… | open | weekly | https://paramus.macaronikid.com/events |
| Mahwah Public Library events | library | Mahwah | open | weekly | https://mahwah.librarycalendar.com/events/upcoming |
| Oakland Public Library | library | Oakland | open | weekly | https://bccls.libcal.com/calendar/oakland |
| Palisades Park Public Library | library | Palisades Park | open | weekly | https://bccls.libcal.com/calendar/palisadespark |
| Paramus Public Library | library | Paramus | open | weekly | https://bccls.libcal.com/calendar/paramus |
| Ramsey Free Public Library | library | Ramsey | open | weekly | https://bccls.libcal.com/calendar/ramsey |
| Ridgefield Park Public Library | library | Ridgefield Park | open | weekly | https://bccls.libcal.com/calendar/ridgefieldpark |
| Ridgefield Public Library | library | Ridgefield | open | weekly | https://bccls.libcal.com/calendar/ridgefield |
| Ridgewood Public Library programs | library | Ridgewood | blocked | weekly | https://ridgewoodlibrary.org/calendar-newsletter/ |
| Rutherford Free Public Library | library | Rutherford | open | weekly | https://bccls.libcal.com/calendar/rutherford |
| Teaneck Public Library | library | Teaneck | open | weekly | https://bccls.libcal.com/calendar/teanecklibrary |
| Tenafly Nature Center seasonal programs | venue_calendar | Tenafly | open | weekly | https://tenaflynaturecenter.org/seasonal-programs/ |
| Tenafly Public Library | library | Tenafly | open | weekly | https://bccls.libcal.com/calendar/tenafly |
| The Bergen County Girl events calendar (The Local Girl) | aggregator | Bergen County | open | weekly | https://thelocalgirl.com/calendar/bergen/ |
| Upper Saddle River Public Library | library | Upper Saddle River | open | weekly | https://bccls.libcal.com/calendar/uppersaddleriver |
| Westwood Public Library | library | Westwood | open | weekly | https://bccls.libcal.com/calendar/westwood |
| YWCA Northern New Jersey events (senior fitness, community programs) | community_org | East Rutherford, Hackensack, Elmwood Park… | open | monthly | https://ywcannj.org/wp-json/tribe/events/v1/events |
| mybergen.com local events calendar | aggregator | Bergen County | blocked | weekly | https://www.mybergen.com/local-events-calendar-nj-northern-new-jersey-bergen-county/ |
| Bergen & Rockland County Singles - 20s & 30s (Meetup) | meetup | Paramus, Westwood, Fair Lawn | js_heavy | weekly | https://www.meetup.com/bergen-county-singles/events/ |
| Bicycle Touring Club of North Jersey ride schedule | community_org | Fair Lawn, Glen Rock, Ramsey… | open | weekly | https://btcnj.com/pages/rideSchedulePublic |
| Big North Conference master calendar (high school sports) | other | Bergen County | js_heavy | weekly | https://live.arbiter.io/org/188306/calendar |
| Bolero Snort Brewery events | venue_calendar | Carlstadt | open | weekly | https://www.bolerosnort.com/events |
| Boozy Burbs (openings and pop-ups tracker) | media_listing | Bergen County | open | weekly | https://www.boozyburbs.com/ |
| Joe Trivia weekly schedule (by day of week) | promoter | Westwood, Tenafly, Paramus… | open | monthly | https://www.joetrivia.com/wednesday |
| Kaplen JCC on the Palisades events | community_org | Tenafly | open | weekly | https://www.jccotp.org/events/ |
| Meetup: social events within 10 miles of Paramus | ticketing_search | Bergen County | open | weekly | https://www.meetup.com/find/?location=us--nj--Paramus&source=EVENTS&distance=tenMiles&categoryId=652 |
| North Jersey Bowling, Volleyball, Tennis & More (Meetup) | meetup | Leonia, River Edge, Edgewater… | js_heavy | weekly | https://www.meetup.com/north-jersey-bowling-soccer-volleyball/events/ |
| Ridgewood Culinary Studio adult classes | venue_calendar | Ridgewood | open | monthly | https://ridgewoodculinarystudio.com/adult-cooking-classes/ |
| RunSignup: races within 10 miles of Paramus (07652) | ticketing_search | Bergen County | open | biweekly | https://runsignup.com/Races?zipcodeRadius=07652&radius=10 |
| BCCLS libraries event calendar (LibCal) | library | Bergen County | js_heavy | weekly | https://bccls.libcal.com/calendar |
| Barrymore Film Center | venue_calendar | Fort Lee | js_heavy | weekly | https://barrymorefilmcenter.org/full-schedule |
| BaseLocal: Bergen County events | aggregator | Bergen County | open | weekly | https://baselocal.com/nj/bergen-county/events/ |
| LIve Music Bergen County NJ (Facebook group) | facebook_group | Bergen County | login_required | weekly | https://www.facebook.com/groups/1711563453037180/ |
| Pinot's Palette Ridgewood | venue_calendar | Ridgewood | open | weekly | https://www.pinotspalette.com/ridgewood/events |
| The Local Music Finder: Bergen County | aggregator | Bergen County | open | weekly | https://www.thelocalmusicfinder.com/events/county/bergen-county-nj |
| Williams Center (Black Box, Cinema Underground) | venue_calendar | Rutherford | open | weekly | https://www.williamscenter.co/calendar/ |
| CZEN Restaurant Englewood | ticketing_organizer | Englewood | open | weekly | https://www.eventbrite.com/o/czen-restaurant-group-94092638983 |
| Eventbrite keyword searches with the town name in the keyword | ticketing_search | Bergen County | open | weekly | https://www.eventbrite.com/d/nj--hackensack/hackensack-party/ |
| Life After Restaurant & Lounge (inside The Metropolitan) | venue_calendar | Edgewater | open | weekly | https://lifeafterrestaurant.com/happeningslifeafterrestaurant |
| Mingle Around Singles (40s 50s 60s - Events & Adventures) | meetup | Paramus, Allendale, Oakland… | open | weekly | https://www.meetup.com/mingle-around-singles-40s-50s-60s-events-adventures/ |
| Shawn's Crazy Saloon | ticketing_organizer | North Arlington | open | weekly | https://www.eventbrite.com/o/shawns-crazy-saloon-20132988259 |
| The Craftsman NJ | venue_calendar | Fair Lawn | open | weekly | https://www.thecraftsmannj.com/projects-8 |
| The Roosevelt (Saturday Night Dance Party DJs) | venue_calendar | East Rutherford | open | weekly | https://theroosevelt.us/calendar/ |
| Williams Center (Black Box / Rivoli / Cinema Underground) | venue_calendar | Rutherford | open | weekly | https://www.williamscenter.co/williams-center-calendar/ |

## Needs a logged-in Facebook or Instagram session

These cannot be read by a plain fetch. They are the queue for the phone agent (Muse) or a signed-in browser pass.

| source | kind | towns | what it posts | page |
|---|---|---|---|---|
| LIve Music Bergen County NJ (Facebook group) | facebook_group | Bergen County | band gig flyers, venue lineups | https://www.facebook.com/groups/1711563453037180/ |
| Borough of Fair Lawn (Facebook) | facebook_page | Fair Lawn | event flyers, recreation announcements | https://www.facebook.com/fairlawnboro |
| City of Englewood (Facebook) | facebook_page | Englewood | event flyers, recreation announcements | https://www.facebook.com/cityofenglewood.org/ |
| Lodi Recreation (Facebook) | facebook_page | Lodi | event flyers, recreation announcements | https://www.facebook.com/LodiRec/ |
| DJ Edwin Martinez, The Salsa Connexion (salsa socials at Zina's) | dj | Teaneck | free public salsa socials, Latin holiday parties | https://www.facebook.com/DJEdwinMartinezTheSalsaConnexion/posts/halloween-latin-partysaturday-october-31stprize-for-the-best-costume-zinas-steak/1804052948389599/ |
| Hackensack Brewing | instagram | Hackensack | beer releases, taproom events, daily happy hour | https://www.instagram.com/hackensackbrewing/ |
| New Jersey Comedy Open Mics (Facebook group) | facebook_group | Bergen County | comedy open mic announcements, new room launches | https://www.facebook.com/groups/njcomedyopenmics/ |
| New Jersey Cover Bands (Facebook group) | facebook_group | Bergen County | cover band gig flyers | https://www.facebook.com/groups/1075339199199750/ |
| North Jersey LIVE MUSIC (Facebook group) | facebook_group | Bergen County | gig flyers, open mics, band lineups | https://www.facebook.com/groups/NorthJerseyLIVEMUSIC/ |
| The Heart of Bergen County (Facebook group) | facebook_group | Bergen County | local events, business promos | https://www.facebook.com/groups/heartofbergen/ |
| Cigarro Bar & Lounge | instagram | Hackensack | 'Let's Dance The Night Away' DJ Saturdays, Latin / global DJ nights, singles nights | https://www.instagram.com/p/DbyddunE-AH/ |
| DAYSHIFT: The 30+ Daytime Party (at Williams Center) | promoter | Rutherford | 30+ daytime dance party, 80s, 90s and 2000s anthems | https://www.instagram.com/p/DQp2qUVgITk/ |
| DJ Frankie D (Sound Illusion DJs) | dj | East Rutherford, Oakland, Bergen County | disco nights, freestyle and house, 'Back in the Day' Saturday nights | https://www.instagram.com/soundillusiondjs_frankie_d/ |
| Lefkes at The Modern (former Ventanas space) | instagram | Fort Lee | Greek supper-club nights with DJs, late-night lounge, New Year's Eve | https://www.instagram.com/p/DeHyeitNql9/ |
| Mason Jar Mahwah: Saturday Night Dance Party with DJ Mike Mariano | instagram | Mahwah | Saturday night dance party: classics, freestyle, today's dance, cover bands | https://www.instagram.com/p/Da5tZUBE-3V/ |
| Midland Brew House (DJ nights) | instagram | Saddle Brook | Ladies Night with DJs every Friday, Saturday DJ Night, Thanksgiving Eve party | https://www.instagram.com/p/Dfh5upjnVOK/ |
| Portobello Restaurant & Bar: Back in the Day Saturday Nights | instagram | Oakland | disco, house and freestyle DJ nights | https://www.instagram.com/p/Db969LwjoYO/ |
| Project 584 Bar & Grill (Decades Saturdays) | instagram | North Arlington | Decades Saturdays: 80s, 90s, 2000s and beyond, no-cover DJ dance nights | https://www.instagram.com/reel/DRNovPsCbK6/ |
| SideBar Hackensack (DJ and live lineup) | instagram | Hackensack | DJ Saturdays, live music, Thanksgiving Eve | https://www.instagram.com/p/DfS1HDqBKq5/ |
| Wisla Club (Polish club nights) | instagram | Garfield | Polish disco polo concerts, dyskoteka / Polish club nights, Andrzejki | https://www.instagram.com/wislaclub/ |
| Borough of Dumont (Facebook) | facebook_page | Dumont | event flyers, recreation announcements | https://www.facebook.com/DumontBorough/ |
| Borough of Montvale (Facebook) | facebook_page | Montvale | event flyers, recreation announcements | https://www.facebook.com/BoroughofMontvale |
| Township of Mahwah (Facebook) | facebook_page | Mahwah | event flyers, recreation announcements | https://www.facebook.com/mahwahtownship |
| Township of Teaneck (Facebook) | facebook_page | Teaneck | event flyers, recreation announcements | https://www.facebook.com/TeaneckNJgov/ |
| Gearblock Brewing Company | instagram | Waldwick | beer releases, taproom events | https://www.instagram.com/gearblockbrewing/ |
| St. Leon Armenian Church | facebook_page | Fair Lawn | Armenian food festival, church bazaars | https://www.facebook.com/stleonchurch |
| The Filipino American Festival, Inc. | facebook_page | Ridgefield Park, Bergenfield | Filipino American Festival, cultural performances and food vendors | https://www.facebook.com/filipinoamericanfestival/ |
| Glen Rock Inn | facebook_page | Glen Rock | jazz and acoustic nights | https://www.facebook.com/TheGlenRockInn |
| Gold Dust Dreams (Fleetwood Mac tribute) | facebook_page | Mahwah | Fleetwood Mac tribute shows | https://www.facebook.com/GoldDustDreamsNJ |
| Bergen County's Nightlife In The 70s and Early 80's | facebook_group | Bergen County | club reunion chatter, nostalgia posts | https://www.facebook.com/groups/bergencountynightlife/ |
| El Alazan Bar & Restaurant: Latin Night with DJ Nico | instagram | Hackensack | Latin night with salsa and bachata classes then social dancing | https://www.instagram.com/reel/DdeZ9d4xBjF/ |
| Hot Night Events (freestyle and club-classics promoter) | promoter | Bergen County | freestyle parties, club classics and house nights, reunion-style dance parties | https://www.facebook.com/HotNightEvents/ |
| Line Dance Events - New Jersey | facebook_group | Fair Lawn, Bergen County | country line dancing nights and lessons | https://www.facebook.com/groups/linedanceeventsnewjersey/ |
| NJ Radar (NJ events app) | instagram | Bergen County | statewide event roundups | https://www.instagram.com/njradar/ |
| Nikki's Bar & Grill | instagram | Little Ferry | Friday DJ party nights | https://www.instagram.com/p/Dd8ISJqF7Dd/ |
| North Jersey Singles 50's & 60's | facebook_group | Bergen County | singles meetups, dance and dinner invitations posted by members | https://www.facebook.com/groups/418700296437196/ |
| Pocha Baekjubu (DJ party nights) | instagram | Fort Lee | Korean pocha DJ parties | https://www.instagram.com/p/DcXilcqNZQZ/ |
| Soosanghan Pocha | instagram | Palisades Park | Korean pocha late nights, private karaoke rooms | https://www.instagram.com/soosanghanpocha_/ |
| Tavern 61 | instagram | Hackensack | Thanksgiving Eve bash, DJ nights | https://www.instagram.com/p/DfYGg0SAH-N/ |
| Taverna Veranda | instagram | Edgewater | live DJ late nights, New Year's Eve party packages, waterfront dinner-then-dance | https://www.instagram.com/reel/DR8WADFkf5I/ |
| The Green Lounge | instagram | South Hackensack | Ladies Night Fridays, Saturday DJ nights, New Year's Eve open bar and buffet | https://www.instagram.com/p/DQsvyDLjbwV/ |
