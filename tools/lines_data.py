# Template network definition used by tools/build_template.py.
# Thameslink, London Cable Car (IFS Cloud) and London Trams are deliberately excluded.
#
# Each line is a list of branches; each branch is an ordered list of station ids.
# Station ids double as display names unless overridden in DISPLAY.

LINES = {
    "bakerloo": {
        "name": "Bakerloo", "color": "#B36305", "style": "solid",
        "branches": [[
            "Harrow & Wealdstone", "Kenton", "South Kenton", "North Wembley", "Wembley Central",
            "Stonebridge Park", "Harlesden", "Willesden Junction", "Kensal Green", "Queen's Park",
            "Kilburn Park", "Maida Vale", "Warwick Avenue", "Paddington", "Edgware Road (Bakerloo)",
            "Marylebone", "Baker Street", "Regent's Park", "Oxford Circus", "Piccadilly Circus",
            "Charing Cross", "Embankment", "Waterloo", "Lambeth North", "Elephant & Castle",
        ]],
    },
    "central": {
        "name": "Central", "color": "#E32017", "style": "solid",
        "branches": [
            ["West Ruislip", "Ruislip Gardens", "South Ruislip", "Northolt", "Greenford", "Perivale",
             "Hanger Lane", "North Acton"],
            ["Ealing Broadway", "West Acton", "North Acton"],
            ["North Acton", "East Acton", "White City", "Shepherd's Bush", "Holland Park",
             "Notting Hill Gate", "Queensway", "Lancaster Gate", "Marble Arch", "Bond Street",
             "Oxford Circus", "Tottenham Court Road", "Holborn", "Chancery Lane", "St Paul's", "Bank",
             "Liverpool Street", "Bethnal Green", "Mile End", "Stratford", "Leyton", "Leytonstone",
             "Snaresbrook", "South Woodford", "Woodford", "Buckhurst Hill", "Loughton", "Debden",
             "Theydon Bois", "Epping"],
            ["Leytonstone", "Wanstead", "Redbridge", "Gants Hill", "Newbury Park", "Barkingside",
             "Fairlop", "Hainault", "Grange Hill", "Chigwell", "Roding Valley", "Woodford"],
        ],
    },
    "circle": {
        "name": "Circle", "color": "#FFD300", "style": "solid",
        "branches": [
            ["Hammersmith (H&C)", "Goldhawk Road", "Shepherd's Bush Market", "Wood Lane", "Latimer Road",
             "Ladbroke Grove", "Westbourne Park", "Royal Oak", "Paddington", "Edgware Road",
             "Baker Street", "Great Portland Street", "Euston Square", "King's Cross St. Pancras",
             "Farringdon", "Barbican", "Moorgate", "Liverpool Street", "Aldgate", "Tower Hill",
             "Monument", "Cannon Street", "Mansion House", "Blackfriars", "Temple", "Embankment",
             "Westminster", "St James's Park", "Victoria", "Sloane Square", "South Kensington",
             "Gloucester Road", "High Street Kensington", "Notting Hill Gate", "Bayswater",
             "Paddington", "Edgware Road"],
        ],
    },
    "district": {
        "name": "District", "color": "#00782A", "style": "solid",
        "branches": [
            ["Ealing Broadway", "Ealing Common", "Acton Town", "Chiswick Park", "Turnham Green",
             "Stamford Brook", "Ravenscourt Park", "Hammersmith", "Barons Court", "West Kensington",
             "Earl's Court", "Gloucester Road", "South Kensington", "Sloane Square", "Victoria",
             "St James's Park", "Westminster", "Embankment", "Temple", "Blackfriars", "Mansion House",
             "Cannon Street", "Monument", "Tower Hill", "Aldgate East", "Whitechapel", "Stepney Green",
             "Mile End", "Bow Road", "Bromley-by-Bow", "West Ham", "Plaistow", "Upton Park",
             "East Ham", "Barking", "Upney", "Becontree", "Dagenham Heathway", "Dagenham East",
             "Elm Park", "Hornchurch", "Upminster Bridge", "Upminster"],
            ["Richmond", "Kew Gardens", "Gunnersbury", "Turnham Green"],
            ["Wimbledon", "Wimbledon Park", "Southfields", "East Putney", "Putney Bridge",
             "Parsons Green", "Fulham Broadway", "West Brompton", "Earl's Court"],
            ["Earl's Court", "Kensington (Olympia)"],
            ["Earl's Court", "High Street Kensington", "Notting Hill Gate", "Bayswater", "Paddington",
             "Edgware Road"],
        ],
    },
    "hammersmith-city": {
        "name": "Hammersmith & City", "color": "#F3A9BB", "style": "solid",
        "branches": [[
            "Hammersmith (H&C)", "Goldhawk Road", "Shepherd's Bush Market", "Wood Lane", "Latimer Road",
            "Ladbroke Grove", "Westbourne Park", "Royal Oak", "Paddington", "Edgware Road",
            "Baker Street", "Great Portland Street", "Euston Square", "King's Cross St. Pancras",
            "Farringdon", "Barbican", "Moorgate", "Liverpool Street", "Aldgate East", "Whitechapel",
            "Stepney Green", "Mile End", "Bow Road", "Bromley-by-Bow", "West Ham", "Plaistow",
            "Upton Park", "East Ham", "Barking",
        ]],
    },
    "jubilee": {
        "name": "Jubilee", "color": "#A0A5A9", "style": "solid",
        "branches": [[
            "Stanmore", "Canons Park", "Queensbury", "Kingsbury", "Wembley Park", "Neasden",
            "Dollis Hill", "Willesden Green", "Kilburn", "West Hampstead", "Finchley Road",
            "Swiss Cottage", "St John's Wood", "Baker Street", "Bond Street", "Green Park",
            "Westminster", "Waterloo", "Southwark", "London Bridge", "Bermondsey", "Canada Water",
            "Canary Wharf", "North Greenwich", "Canning Town", "West Ham", "Stratford",
        ]],
    },
    "metropolitan": {
        "name": "Metropolitan", "color": "#9B0056", "style": "solid",
        "branches": [
            ["Aldgate", "Liverpool Street", "Moorgate", "Barbican", "Farringdon",
             "King's Cross St. Pancras", "Euston Square", "Great Portland Street", "Baker Street",
             "Finchley Road", "Wembley Park", "Preston Road", "Northwick Park", "Harrow-on-the-Hill",
             "North Harrow", "Pinner", "Northwood Hills", "Northwood", "Moor Park", "Rickmansworth",
             "Chorleywood", "Chalfont & Latimer", "Amersham"],
            ["Chalfont & Latimer", "Chesham"],
            ["Moor Park", "Croxley", "Watford"],
            ["Harrow-on-the-Hill", "West Harrow", "Rayners Lane", "Eastcote", "Ruislip Manor",
             "Ruislip", "Ickenham", "Hillingdon", "Uxbridge"],
        ],
    },
    "northern": {
        "name": "Northern", "color": "#000000", "style": "solid",
        "branches": [
            ["Edgware", "Burnt Oak", "Colindale", "Hendon Central", "Brent Cross", "Golders Green",
             "Hampstead", "Belsize Park", "Chalk Farm", "Camden Town"],
            ["High Barnet", "Totteridge & Whetstone", "Woodside Park", "West Finchley",
             "Finchley Central", "East Finchley", "Highgate", "Archway", "Tufnell Park",
             "Kentish Town", "Camden Town"],
            ["Mill Hill East", "Finchley Central"],
            ["Camden Town", "Mornington Crescent", "Euston", "Warren Street", "Goodge Street",
             "Tottenham Court Road", "Leicester Square", "Charing Cross", "Embankment", "Waterloo",
             "Kennington"],
            ["Camden Town", "Euston", "King's Cross St. Pancras", "Angel", "Old Street", "Moorgate",
             "Bank", "London Bridge", "Borough", "Elephant & Castle", "Kennington", "Oval",
             "Stockwell", "Clapham North", "Clapham Common", "Clapham South", "Balham",
             "Tooting Bec", "Tooting Broadway", "Colliers Wood", "South Wimbledon", "Morden"],
            ["Kennington", "Nine Elms", "Battersea Power Station"],
        ],
    },
    "piccadilly": {
        "name": "Piccadilly", "color": "#003688", "style": "solid",
        "branches": [
            ["Cockfosters", "Oakwood", "Southgate", "Arnos Grove", "Bounds Green", "Wood Green",
             "Turnpike Lane", "Manor House", "Finsbury Park", "Arsenal", "Holloway Road",
             "Caledonian Road", "King's Cross St. Pancras", "Russell Square", "Holborn",
             "Covent Garden", "Leicester Square", "Piccadilly Circus", "Green Park",
             "Hyde Park Corner", "Knightsbridge", "South Kensington", "Gloucester Road",
             "Earl's Court", "Barons Court", "Hammersmith", "Turnham Green", "Acton Town"],
            ["Acton Town", "Ealing Common", "North Ealing", "Park Royal", "Alperton", "Sudbury Town",
             "Sudbury Hill", "South Harrow", "Rayners Lane", "Eastcote", "Ruislip Manor", "Ruislip",
             "Ickenham", "Hillingdon", "Uxbridge"],
            ["Acton Town", "South Ealing", "Northfields", "Boston Manor", "Osterley", "Hounslow East",
             "Hounslow Central", "Hounslow West", "Hatton Cross", "Heathrow Terminals 2 & 3",
             "Heathrow Terminal 5"],
            ["Hatton Cross", "Heathrow Terminal 4", "Heathrow Terminals 2 & 3"],
        ],
    },
    "victoria": {
        "name": "Victoria", "color": "#0098D4", "style": "solid",
        "branches": [[
            "Walthamstow Central", "Blackhorse Road", "Tottenham Hale", "Seven Sisters",
            "Finsbury Park", "Highbury & Islington", "King's Cross St. Pancras", "Euston",
            "Warren Street", "Oxford Circus", "Green Park", "Victoria", "Pimlico", "Vauxhall",
            "Stockwell", "Brixton",
        ]],
    },
    "waterloo-city": {
        "name": "Waterloo & City", "color": "#95CDBA", "style": "solid",
        "branches": [["Bank", "Waterloo"]],
    },
    "dlr": {
        "name": "DLR", "color": "#00A4A7", "style": "double",
        "branches": [
            ["Bank", "Shadwell", "Limehouse", "Westferry", "Poplar", "West India Quay", "Canary Wharf",
             "Heron Quays", "South Quay", "Crossharbour", "Mudchute", "Island Gardens",
             "Cutty Sark for Maritime Greenwich", "Greenwich", "Deptford Bridge", "Elverson Road",
             "Lewisham"],
            ["Tower Gateway", "Shadwell"],
            ["Stratford", "Pudding Mill Lane", "Bow Church", "Devons Road", "Langdon Park",
             "All Saints", "Poplar", "Blackwall", "East India", "Canning Town"],
            ["Stratford International", "Stratford", "Stratford High Street", "Abbey Road",
             "West Ham", "Star Lane", "Canning Town", "Royal Victoria", "Custom House",
             "Prince Regent", "Royal Albert", "Beckton Park", "Cyprus", "Gallions Reach", "Beckton"],
            ["Canning Town", "West Silvertown", "Pontoon Dock", "London City Airport",
             "King George V", "Woolwich Arsenal"],
        ],
    },
    "elizabeth": {
        "name": "Elizabeth line", "color": "#6950A1", "style": "double",
        "branches": [
            ["Reading", "Twyford", "Maidenhead", "Taplow", "Burnham", "Slough", "Langley", "Iver",
             "West Drayton", "Hayes & Harlington", "Southall", "Hanwell", "West Ealing",
             "Ealing Broadway", "Acton Main Line", "Paddington", "Bond Street",
             "Tottenham Court Road", "Farringdon", "Liverpool Street", "Whitechapel", "Stratford",
             "Maryland", "Forest Gate", "Manor Park", "Ilford", "Seven Kings", "Goodmayes",
             "Chadwell Heath", "Romford", "Gidea Park", "Harold Wood", "Brentwood", "Shenfield"],
            ["Heathrow Terminal 5", "Heathrow Terminals 2 & 3", "Hayes & Harlington"],
            ["Heathrow Terminal 4", "Heathrow Terminals 2 & 3"],
            ["Whitechapel", "Canary Wharf", "Custom House", "Woolwich", "Abbey Wood"],
        ],
    },
    "liberty": {
        "name": "Liberty line", "color": "#5D6061", "style": "double", "group": "London Overground",
        "branches": [["Romford", "Emerson Park", "Upminster"]],
    },
    "lioness": {
        "name": "Lioness line", "color": "#FAA61A", "style": "double", "group": "London Overground",
        "branches": [[
            "Euston", "South Hampstead", "Kilburn High Road", "Queen's Park", "Kensal Green",
            "Willesden Junction", "Harlesden", "Stonebridge Park", "Wembley Central",
            "North Wembley", "South Kenton", "Kenton", "Harrow & Wealdstone", "Headstone Lane",
            "Hatch End", "Carpenders Park", "Bushey", "Watford High Street", "Watford Junction",
        ]],
    },
    "mildmay": {
        "name": "Mildmay line", "color": "#0077AD", "style": "double", "group": "London Overground",
        "branches": [
            ["Richmond", "Kew Gardens", "Gunnersbury", "South Acton", "Acton Central",
             "Willesden Junction", "Kensal Rise", "Brondesbury Park", "Brondesbury",
             "West Hampstead", "Finchley Road & Frognal", "Hampstead Heath", "Gospel Oak",
             "Kentish Town West", "Camden Road", "Caledonian Road & Barnsbury",
             "Highbury & Islington", "Canonbury", "Dalston Kingsland", "Hackney Central",
             "Homerton", "Hackney Wick", "Stratford"],
            ["Clapham Junction", "Imperial Wharf", "West Brompton", "Kensington (Olympia)",
             "Shepherd's Bush", "Willesden Junction"],
        ],
    },
    "suffragette": {
        "name": "Suffragette line", "color": "#5BBD72", "style": "double", "group": "London Overground",
        "branches": [[
            "Gospel Oak", "Upper Holloway", "Crouch Hill", "Harringay Green Lanes",
            "South Tottenham", "Blackhorse Road", "Walthamstow Queen's Road",
            "Leyton Midland Road", "Leytonstone High Road", "Wanstead Park", "Woodgrange Park",
            "Barking", "Barking Riverside",
        ]],
    },
    "weaver": {
        "name": "Weaver line", "color": "#823A62", "style": "double", "group": "London Overground",
        "branches": [
            ["Liverpool Street", "Bethnal Green (Weaver)", "Cambridge Heath", "London Fields",
             "Hackney Downs", "Rectory Road", "Stoke Newington", "Stamford Hill", "Seven Sisters",
             "Bruce Grove", "White Hart Lane", "Silver Street", "Edmonton Green", "Southbury",
             "Turkey Street", "Theobalds Grove", "Cheshunt"],
            ["Hackney Downs", "Clapton", "St James Street", "Walthamstow Central", "Wood Street",
             "Highams Park", "Chingford"],
            ["Edmonton Green", "Bush Hill Park", "Enfield Town"],
        ],
    },
    "windrush": {
        "name": "Windrush line", "color": "#ED1B00", "style": "double", "group": "London Overground",
        "branches": [
            ["Highbury & Islington", "Canonbury", "Dalston Junction", "Haggerston", "Hoxton",
             "Shoreditch High Street", "Whitechapel", "Shadwell", "Wapping", "Rotherhithe",
             "Canada Water", "Surrey Quays", "New Cross Gate", "Brockley", "Honor Oak Park",
             "Forest Hill", "Sydenham", "Crystal Palace"],
            ["Sydenham", "Penge West", "Anerley", "Norwood Junction", "West Croydon"],
            ["Surrey Quays", "New Cross"],
            ["Surrey Quays", "Queens Road Peckham", "Peckham Rye", "Denmark Hill",
             "Clapham High Street", "Wandsworth Road", "Clapham Junction"],
        ],
    },
}

# Display names that differ from the station id.
DISPLAY = {
    "Edgware Road (Bakerloo)": "Edgware Road",
    "Hammersmith (H&C)": "Hammersmith",
    "Bethnal Green (Weaver)": "Bethnal Green",
}

# Words to search for in the reference PDF when they differ from the display name.
SEARCH = {
    "King's Cross St. Pancras": "King's Cross",
    "Edgware Road (Bakerloo)": "Edgware Road",
    "Hammersmith (H&C)": "Hammersmith",
    "Bethnal Green (Weaver)": "Bethnal Green",
    "Cutty Sark for Maritime Greenwich": "Cutty Sark",
    "Heathrow Terminals 2 & 3": "Heathrow Terminals 2",
}

# National Rail interchanges (key symbol), from the TfL station index.
NATIONAL_RAIL = set("""Amersham|Barking|Blackfriars|Bromley-by-Bow|Cannon Street|Charing Cross|Chalfont & Latimer|Chorleywood|Clapham Junction|Crystal Palace|Denmark Hill|Ealing Broadway|Elephant & Castle|Euston|Farringdon|Finsbury Park|Forest Hill|Greenwich|Gunnersbury|Hackney Downs|Harrow & Wealdstone|Hayes & Harlington|Highbury & Islington|Honor Oak Park|Kensington (Olympia)|Kentish Town|King's Cross St. Pancras|Lewisham|Liverpool Street|London Bridge|Marylebone|Moorgate|New Cross|New Cross Gate|Norwood Junction|Old Street|Paddington|Peckham Rye|Queens Road Peckham|Reading|Richmond|Romford|Seven Sisters|Shenfield|Slough|Stratford|Sydenham|Tottenham Hale|Upminster|Vauxhall|Victoria|Walthamstow Central|Waterloo|West Croydon|West Ham|West Hampstead|West Brompton|Shepherd's Bush|Wimbledon|Woolwich Arsenal|Abbey Wood|Brentwood|Maidenhead|Twyford|West Drayton|Southall|Brixton|Watford Junction|Clapham High Street|Wandsworth Road|Imperial Wharf|Sydenham|Penge West|Anerley|Brockley|Cheshunt|Enfield Town|Chingford|Rickmansworth|Harrow-on-the-Hill|Wembley Central|Willesden Junction|Kenton|Queen's Park|Whitechapel|Woolwich|Deptford Bridge|Limehouse|Hackney Central|Hampstead Heath|Gospel Oak|Leyton Midland Road|Wanstead Park|Woodgrange Park|Emerson Park|Ilford|Romford|Goodmayes|Chadwell Heath|Gidea Park|Harold Wood|Forest Gate|Manor Park|Maryland|Seven Kings|Acton Main Line|West Ealing|Hanwell|Langley|Iver|Burnham|Taplow""".split("|"))

AIRPORT = {"Heathrow Terminals 2 & 3", "Heathrow Terminal 4", "Heathrow Terminal 5", "London City Airport"}

RIVER = {"Embankment", "Westminster", "Waterloo", "Blackfriars", "Tower Hill", "Tower Gateway",
         "London Bridge", "Canary Wharf", "Greenwich", "Cutty Sark for Maritime Greenwich",
         "North Greenwich", "Woolwich Arsenal", "Battersea Power Station", "Putney Bridge",
         "Vauxhall", "Bermondsey", "Rotherhithe", "Wapping", "Westferry", "Richmond", "Kew Gardens",
         "Royal Victoria", "Pimlico", "Canada Water", "Surrey Quays"}

COACH = {"Victoria"}

# Step-free from street to train (blue disc) -- a representative subset.
STEP_FREE_TRAIN = set("""Stratford|Canning Town|West Ham|Canary Wharf|North Greenwich|Canada Water|Bermondsey|Southwark|Westminster|Green Park|London Bridge|Waterloo|Stanmore|Wembley Park|Heathrow Terminals 2 & 3|Heathrow Terminal 4|Heathrow Terminal 5|Hatton Cross|Tottenham Court Road|Bond Street|Farringdon|Liverpool Street|Whitechapel|Paddington|Custom House|Woolwich|Abbey Wood|Battersea Power Station|Nine Elms|Bank|Cannon Street|King's Cross St. Pancras|Victoria|Elephant & Castle|Amersham|Chesham|Uxbridge|Hillingdon|Ealing Broadway|Shepherd's Bush|Wood Lane|Earl's Court|Brixton|Tottenham Hale|Blackhorse Road|Walthamstow Central|Romford|Shenfield|Reading|Woolwich Arsenal|Lewisham|Beckton|London City Airport|Barking Riverside|Crystal Palace|West Croydon|Clapham Junction|Harrow-on-the-Hill|Stratford International|Tower Gateway|Poplar|Shadwell|Westferry|Limehouse|Pudding Mill Lane|Bow Church|All Saints|Langdon Park|Devons Road|Greenwich|Deptford Bridge|Elverson Road|Island Gardens|Mudchute|Crossharbour|South Quay|Heron Quays|West India Quay|Blackwall|East India|Royal Victoria|Prince Regent|Royal Albert|Beckton Park|Cyprus|Gallions Reach|West Silvertown|Pontoon Dock|King George V|Star Lane|Abbey Road|Stratford High Street|Cutty Sark for Maritime Greenwich""".split("|"))

STEP_FREE_PLATFORM = set("""Moorgate|Highbury & Islington|Finsbury Park|Seven Sisters|Wimbledon|Morden|Edgware|High Barnet|Cockfosters|Oakwood|Epping|Hainault|Newbury Park|Upminster|Barking|Harrow & Wealdstone|Watford Junction|Willesden Junction|Kensington (Olympia)|West Brompton|Richmond|Kew Gardens|Gunnersbury|Acton Town|Hounslow West|Osterley|Fulham Broadway|Hammersmith|Wembley Central|West Hampstead|Kentish Town West|Dalston Junction|Haggerston|Hoxton|Shoreditch High Street|Wapping|Rotherhithe|Surrey Quays|Hackney Wick|Homerton|Hackney Central|Dalston Kingsland|Canonbury""".split("|"))
