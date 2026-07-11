# Analysis Report: Vizag Data Source Exploration and Mock Dataset Design

## Executive Summary
A comprehensive scan of the `jannaadi` workspace was performed to locate any pre-existing cached data, logs, scripts, or seed files representing the four target government websites (`india.gov.in`, `gpdp.nic.in`, `pppinindia.gov.in`, and `pib.gov.in`). 

Apart from text references in project checklists (`PROJECT.md`, `SPRINT.md`) and agent metadata (`BRIEFING.md` files), no actual datasets, scrape outputs, or mock files representing these domains were found. 

To unblock development, this report details the designed schemas and provides realistic, structured mock datasets representing Visakhapatnam (Vizag) district for each of the four target sources. All designed data conforms strictly to the requirements of the project.

---

## 1. Codebase Scan Findings
The workspace was searched via case-insensitive grep and pattern matching. The results are summarized below:
- **`gpdp.nic.in`**: Only referenced in documentation/metadata files (`PROJECT.md`, `.agents/orchestrator/plan.md`, `BRIEFING.md`, etc.). No CSV/JSON/SQL files containing scrapings or mock data exist.
- **`pppinindia.gov.in`**: Only referenced in documentation/metadata files. No infrastructure datasets found.
- **`india.gov.in`**: Only referenced in documentation/metadata files. No administrative directories found.
- **`pib.gov.in`**: Only referenced in documentation/metadata files. No press release datasets found.
- **Other Data Assets**: 
  - `data/synthetic.jsonl` contains 776 records of simulated citizen grievances across 98 GVMC wards.
  - `data/wards_clean.json` and `data/wards_real.sql` contain the official list of 98 GVMC wards.
  - `db/ward_population.sql` contains official census population and SC/ST percentage data for 72 GVMC wards.
  - `data/raw-plans/` contains master plans (PDFs & TXT metadata) for 8 municipal zones in the Visakhapatnam-Vizianagaram region.

---

## 2. Mock Dataset Designs for Visakhapatnam District

To represent the four target domains, we design four separate JSON data structures. Each structure mimics the real-world reporting format of its respective website and links the records directly to Visakhapatnam.

### A. Demographics (`gpdp.nic.in` - Gram Panchayat Development Plan)
* **Real-world Context**: GPDP reports are structured around Gram Panchayats (GP), Mandals (Blocks), and Districts. They contain total population, gender split, and social category counts (SC/ST).
* **Connection to Vizag**: Data covers suburban and rural mandals of Visakhapatnam District (such as Bheemunipatnam, Pendurthi, Anandapuram, Gajuwaka) and provides mapping to GVMC wards where boundaries overlap.
* **Schema Design**:
  ```json
  {
    "source_url": "gpdp.nic.in",
    "district": "Visakhapatnam",
    "state": "Andhra Pradesh",
    "census_year": 2011,
    "last_updated": "2026-07-08T15:13:55Z",
    "records": [
      {
        "gp_lgd_code": 204561,
        "gp_name": "Nidigattu Gram Panchayat",
        "mandal_name": "Bheemunipatnam",
        "mapped_gvmc_ward": "Ward 4 - Nidigattu panchayat",
        "demographics": {
          "total_population": 18267,
          "gender": { "male": 9070, "female": 9197 },
          "social_vulnerabilities": {
            "sc_count": 1555, "sc_percentage": 8.51,
            "st_count": 203, "st_percentage": 1.11
          }
        }
      }
    ]
  }
  ```

### B. Infrastructure/PPP (`pppinindia.gov.in` - Public-Private Partnerships)
* **Real-world Context**: The Indian PPP database tracks major capital-intensive public-private initiatives. It lists project sector, sub-sector, government agency, concessionaire (private partner), cost, mode, status, and timeline.
* **Connection to Vizag**: Includes key infrastructure landmarks of Visakhapatnam: Bhogapuram Greenfield Airport, Visakhapatnam Port EQ-7 Berth mechanization, and the Visakhapatnam Metro Rail (Phase 1).
* **Schema Design**:
  ```json
  {
    "source_url": "pppinindia.gov.in",
    "location_filter": "Visakhapatnam",
    "projects": [
      {
        "project_id": "PPP-AP-VIZ-001",
        "project_name": "Development of Bhogapuram International Airport",
        "sector": "Airports",
        "sub_sector": "Greenfield Airport",
        "authority": "Andhra Pradesh Airports Development Corporation Ltd (APADCL)",
        "private_partner": "GMR Visakhapatnam International Airport Ltd (GVIAL)",
        "project_cost_inr_cr": 2200.0,
        "ppp_mode": "Design, Build, Finance, Operate and Transfer (DBFOT)",
        "status": "Under Construction",
        "concession_period_years": 40,
        "coordinates": { "lat": 18.0058, "lng": 83.5012 }
      }
    ]
  }
  ```

### C. Press Releases (`pib.gov.in` - Press Information Bureau)
* **Real-world Context**: PIB documents press releases issued by Central Ministries. They include release date, headline, ministry name, city from which it was issued, and a text body describing policies/schemes.
* **Connection to Vizag**: Covers press announcements regarding urban development in Visakhapatnam (e.g., Amrit Bharat station redevelopment, Sagarmala port projects, PM e-Bus scheme, Smart City grants).
* **Schema Design**:
  ```json
  {
    "source_url": "pib.gov.in",
    "press_releases": [
      {
        "release_id": "PIB-VIZ-2026-001",
        "ministry": "Ministry of Railways",
        "date": "2026-05-15T12:30:00Z",
        "headline": "PM Modi Reviews Redevelopment Progress of Visakhapatnam Railway Station",
        "city": "Visakhapatnam",
        "text": "Prime Minister Narendra Modi today reviewed the redevelopment works of the Visakhapatnam Railway Station under the Amrit Bharat Station Scheme...",
        "associated_sectors": ["Railways", "Infrastructure", "Smart Cities"]
      }
    ]
  }
  ```

### D. Administrative Directory (`india.gov.in` - National Portal of India)
* **Real-world Context**: The administrative directory lists the hierarchy of key local government officers, their designations, departments, addresses, and contacts.
* **Connection to Vizag**: Focuses on key administrators in Visakhapatnam district and the GVMC municipal government.
* **Schema Design**:
  ```json
  {
    "source_url": "india.gov.in",
    "district": "Visakhapatnam",
    "state": "Andhra Pradesh",
    "officials": [
      {
        "designation": "District Collector & District Magistrate",
        "name": "Shri M. N. Harendhira Prasad, IAS",
        "department": "Revenue and District Administration",
        "office": "Collectorate Office, Maharanipeta, Visakhapatnam - 530002",
        "email": "collector_vsp@ap.gov.in",
        "phone": "+91-891-2565007",
        "website": "https://visakhapatnam.ap.gov.in"
      }
    ]
  }
  ```

---

## 3. Complete Draft Mock Datasets

To ensure the worker can copy and write these files directly into the target directory `data/source_data/`, we present the complete, realistic JSON mock files.

### 1. `data/source_data/gpdp_demographics.json`
```json
{
  "source_url": "gpdp.nic.in",
  "district": "Visakhapatnam",
  "state": "Andhra Pradesh",
  "census_year": 2011,
  "last_updated": "2026-07-08T15:13:55Z",
  "records": [
    {
      "gp_lgd_code": 204561,
      "gp_name": "Nidigattu Gram Panchayat",
      "mandal_name": "Bheemunipatnam",
      "mapped_gvmc_ward": "Ward 4 - Nidigattu panchayat",
      "demographics": {
        "total_population": 18267,
        "gender": { "male": 9070, "female": 9197 },
        "social_vulnerabilities": {
          "sc_count": 1555,
          "sc_percentage": 8.51,
          "st_count": 203,
          "st_percentage": 1.11
        }
      }
    },
    {
      "gp_lgd_code": 204562,
      "gp_name": "Boyyipalem Gram Panchayat",
      "mandal_name": "Bheemunipatnam",
      "mapped_gvmc_ward": "Ward 5 - Boyyipalem Junction",
      "demographics": {
        "total_population": 18390,
        "gender": { "male": 9104, "female": 9286 },
        "social_vulnerabilities": {
          "sc_count": 1639,
          "sc_percentage": 8.91,
          "st_count": 334,
          "st_percentage": 1.82
        }
      }
    },
    {
      "gp_lgd_code": 204563,
      "gp_name": "Bunglow Metta Gram Panchayat",
      "mandal_name": "Bheemunipatnam",
      "mapped_gvmc_ward": "Ward 1 - Bunglow Metta",
      "demographics": {
        "total_population": 18598,
        "gender": { "male": 9210, "female": 9388 },
        "social_vulnerabilities": {
          "sc_count": 2284,
          "sc_percentage": 12.28,
          "st_count": 286,
          "st_percentage": 1.54
        }
      }
    },
    {
      "gp_lgd_code": 204564,
      "gp_name": "Sabbivanipeta Gram Panchayat",
      "mandal_name": "Pendurthi",
      "mapped_gvmc_ward": "Ward 2 - Sabbivanipeta",
      "demographics": {
        "total_population": 17966,
        "gender": { "male": 8940, "female": 9026 },
        "social_vulnerabilities": {
          "sc_count": 1733,
          "sc_percentage": 9.65,
          "st_count": 62,
          "st_percentage": 0.35
        }
      }
    },
    {
      "gp_lgd_code": 204565,
      "gp_name": "Pendurthi old Village",
      "mandal_name": "Pendurthi",
      "mapped_gvmc_ward": "Ward 96 - Pendurthi old Village",
      "demographics": {
        "total_population": 21594,
        "gender": { "male": 10790, "female": 10804 },
        "social_vulnerabilities": {
          "sc_count": 1506,
          "sc_percentage": 8.27,
          "st_count": 83,
          "st_percentage": 0.46
        }
      }
    }
  ]
}
```

### 2. `data/source_data/pppinindia_infrastructure.json`
```json
{
  "source_url": "pppinindia.gov.in",
  "location_filter": "Visakhapatnam",
  "projects": [
    {
      "project_id": "PPP-AP-VIZ-001",
      "project_name": "Development of Bhogapuram International Airport",
      "sector": "Airports",
      "sub_sector": "Greenfield Airport",
      "authority": "Andhra Pradesh Airports Development Corporation Ltd (APADCL)",
      "private_partner": "GMR Visakhapatnam International Airport Ltd (GVIAL)",
      "project_cost_inr_cr": 2200.00,
      "ppp_mode": "Design, Build, Finance, Operate and Transfer (DBFOT)",
      "status": "Under Construction",
      "concession_period_years": 40,
      "concession_signing_date": "2020-06-12",
      "coordinates": {
        "lat": 18.0058,
        "lng": 83.5012
      },
      "description": "Construction and operation of a new greenfield international airport at Bhogapuram to handle passenger and cargo traffic serving the Visakhapatnam region."
    },
    {
      "project_id": "PPP-AP-VIZ-002",
      "project_name": "Visakhapatnam Port Trust - Mechanization of EQ-7 Berth",
      "sector": "Ports",
      "sub_sector": "Cargo Berths",
      "authority": "Visakhapatnam Port Authority (VPA)",
      "private_partner": "Vizag Coal Terminal Pvt Ltd",
      "project_cost_inr_cr": 217.80,
      "ppp_mode": "Build, Operate and Transfer (BOT)",
      "status": "Operational",
      "concession_period_years": 30,
      "concession_signing_date": "2013-10-18",
      "coordinates": {
        "lat": 17.6942,
        "lng": 83.2986
      },
      "description": "Mechanization of East Quay-7 berth at Visakhapatnam Port for handling steam coal and thermal coal imports."
    },
    {
      "project_id": "PPP-AP-VIZ-003",
      "project_name": "Visakhapatnam Metro Rail Project - Phase 1",
      "sector": "Urban Transport",
      "sub_sector": "Metro Rail",
      "authority": "Amaravati Metro Rail Corporation (AMRC) / AP Metro Rail Corporation",
      "private_partner": "TBD (PPP Procurement Stage)",
      "project_cost_inr_cr": 8300.00,
      "ppp_mode": "Design, Build, Finance, Operate and Transfer (DBFOT)",
      "status": "Proposed / Under Procurement",
      "concession_period_years": 35,
      "concession_signing_date": null,
      "coordinates": {
        "lat": 17.7234,
        "lng": 83.3012
      },
      "description": "Mass Rapid Transit System for Visakhapatnam covering 3 corridors: Steel Plant to Kamalalayam (34 km), Gurudwara to Old Post Office (5 km), and Madhurawada to Nad Junction (20 km)."
    },
    {
      "project_id": "PPP-AP-VIZ-004",
      "project_name": "Multi-Modal Logistics Park (MMLP) at Visakhapatnam",
      "sector": "Infrastructure (Commercial)",
      "sub_sector": "Logistics Park",
      "authority": "National Highways Logistics Management Limited (NHLML) / CONCOR",
      "private_partner": "VMLP Private Limited",
      "project_cost_inr_cr": 372.00,
      "ppp_mode": "Design, Build, Finance, Operate and Transfer (DBFOT)",
      "status": "Operational",
      "concession_period_years": 30,
      "concession_signing_date": "2015-04-20",
      "coordinates": {
        "lat": 17.7122,
        "lng": 83.1895
      },
      "description": "Development of a Multi-Modal Logistics Park over 100 acres in Visakhapatnam to provide warehousing, container storage, and rail-road transfer facilities."
    }
  ]
}
```

### 3. `data/source_data/pib_press_releases.json`
```json
{
  "source_url": "pib.gov.in",
  "location_filter": "Visakhapatnam",
  "press_releases": [
    {
      "release_id": "PIB-VIZ-202605-01",
      "ministry": "Ministry of Railways",
      "date": "2026-05-15T12:30:00Z",
      "headline": "PM Modi Reviews Redevelopment Progress of Visakhapatnam Railway Station",
      "city": "Visakhapatnam",
      "text": "Prime Minister Narendra Modi today reviewed the redevelopment works of the Visakhapatnam Railway Station under the Amrit Bharat Station Scheme. The redevelopment, costing over Rs 450 crore, aims to transform the station into a world-class transit hub with state-of-the-art amenities, separate arrival and departure plazas, integration with other modes of transport, and eco-friendly features. The station will utilize smart lighting and solar power systems to achieve net-zero energy compliance.",
      "associated_sectors": ["Railways", "Infrastructure", "Smart Cities"],
      "impacted_wards": ["Ward 30 - Old Employment Office", "Ward 32 - South Jail Road"]
    },
    {
      "release_id": "PIB-VIZ-202606-02",
      "ministry": "Ministry of Ports, Shipping and Waterways",
      "date": "2026-06-20T10:15:00Z",
      "headline": "Union Minister Inspects Sagarmala Port Projects and Connectivity Corridors in Visakhapatnam",
      "city": "Visakhapatnam",
      "text": "The Union Minister for Ports, Shipping and Waterways inspected several key connectivity and capacity enhancement projects in Visakhapatnam today. Under the Sagarmala Programme, projects worth over Rs 1,200 crore are currently being executed, including the creation of a flyover from Convent Junction to Gajuwaka Road to streamline freight transport and minimize municipal traffic congestion. Special emphasis is being placed on environmental safeguards and mitigating dust pollution in coastal wards.",
      "associated_sectors": ["Ports", "Roads", "Freight Transport"],
      "impacted_wards": ["Ward 21 - Harbour Park road", "Ward 45 - Port Quarters"]
    },
    {
      "release_id": "PIB-VIZ-202607-03",
      "ministry": "Ministry of Housing and Urban Affairs",
      "date": "2026-07-01T16:45:00Z",
      "headline": "GVMC Receives Additional Smart Cities Grant for Urban Sewerage and Drainage Upgrades",
      "city": "New Delhi",
      "text": "The Ministry of Housing and Urban Affairs today sanctioned an additional grant of Rs 85 crore to the Greater Visakhapatnam Municipal Corporation (GVMC) under the Smart Cities Mission. The funding is earmarked specifically for resolving localized flooding and drainage issues in low-lying sectors including Pedagantyada, Gajuwaka, and parts of MVP Colony. GVMC will deploy real-time water logging sensors linked to the Integrated Command and Control Centre (ICCC) to optimize drainage pumping.",
      "associated_sectors": ["Drainage", "Urban Water Management", "Smart Cities"],
      "impacted_wards": ["Ward 19 - MVP Sector-12", "Ward 75 - Pedagantyada", "Ward 83 - Mirayala Colony"]
    },
    {
      "release_id": "PIB-VIZ-202607-04",
      "ministry": "Ministry of Heavy Industries",
      "date": "2026-07-05T09:00:00Z",
      "headline": "PM-eBus Sewa Initiative Rolls Out 100 Electric Buses in Visakhapatnam to Promote Clean Transit",
      "city": "Visakhapatnam",
      "text": "A fleet of 100 state-of-the-art electric buses was flagged off in Visakhapatnam today under the PM-eBus Sewa scheme. The initiative, funded in partnership with the State Government, aims to decarbonize public transit and provide reliable municipal transport. Charge depots have been constructed at Maddilapalem and Gajuwaka. The buses will serve routes linking major residential areas like Pendurthi, MVP Colony, and Seethammadhara to industrial hubs.",
      "associated_sectors": ["Urban Transport", "Clean Energy", "Environment"],
      "impacted_wards": ["Ward 15 - Seethammadhara Junction", "Ward 19 - MVP Sector-12", "Ward 96 - Pendurthi old Village"]
    }
  ]
}
```

### 4. `data/source_data/india_administrative_directory.json`
```json
{
  "source_url": "india.gov.in",
  "district": "Visakhapatnam",
  "state": "Andhra Pradesh",
  "state_headquarters": "Amaravati",
  "officials": [
    {
      "designation": "District Collector & District Magistrate",
      "name": "Shri M. N. Harendhira Prasad, IAS",
      "department": "Revenue and District Administration",
      "office_address": "Collectorate Office, Maharanipeta, Visakhapatnam - 530002",
      "contact": {
        "phone": "+91-891-2565007",
        "email": "collector_vsp@ap.gov.in",
        "website": "https://visakhapatnam.ap.gov.in"
      }
    },
    {
      "designation": "Commissioner, Greater Visakhapatnam Municipal Corporation",
      "name": "Dr. P. Sampath Kumar, IAS",
      "department": "Municipal Administration (GVMC)",
      "office_address": "GVMC Main Office, Tenneti Nagar, Visakhapatnam - 530003",
      "contact": {
        "phone": "+91-891-2746300",
        "email": "commissioner.gvmc@gmail.com",
        "website": "https://gvmc.gov.in"
      }
    },
    {
      "designation": "Commissioner of Police, Visakhapatnam City",
      "name": "Shri Dr. A. Ravi Shankar, IPS",
      "department": "Home (Police Dept)",
      "office_address": "Police Commissionerate, Suryabagh, Visakhapatnam - 530020",
      "contact": {
        "phone": "+91-891-2565454",
        "email": "cop.vsp@ap.gov.in",
        "website": "https://vizagcitypolice.gov.in"
      }
    },
    {
      "designation": "Joint Collector & Additional District Magistrate",
      "name": "Shri K. Mayur Ashok, IAS",
      "department": "Revenue and District Administration",
      "office_address": "Collectorate Office, Maharanipeta, Visakhapatnam - 530002",
      "contact": {
        "phone": "+91-891-2563121",
        "email": "jc_vsp@ap.gov.in",
        "website": "https://visakhapatnam.ap.gov.in"
      }
    },
    {
      "designation": "Metropolitan Commissioner, VMRDA",
      "name": "Smt. K. Sandhya Rani, IRAS",
      "department": "Visakhapatnam Metropolitan Region Development Authority",
      "office_address": "VMRDA Office Complex, Siripuram, Visakhapatnam - 530003",
      "contact": {
        "phone": "+91-891-2754133",
        "email": "mcvmrda@ap.gov.in",
        "website": "https://vmrda.gov.in"
      }
    }
  ]
}
```

---

## 4. Integration Analysis & Recommendations

1. **Storage Location**: The mock data files should be placed under `c:\Users\nagen\JanNaadi\jannaadi\data\source_data/` as per the path defined in `PROJECT.md`.
2. **Schema Integration**: 
   - Demographics data can be integrated into the DB seed scripts or parsed directly via ingestion scripts to cross-check user reports with the local demographics (e.g. calculating dynamic vulnerability weighting during routing).
   - Press releases can be parsed into the Discovery Engine Datastore or processed via semantic search matching to relate resident complaints to specific government initiatives (the `plan_match` logic).
   - Administrative records can serve as the recipient lookup directory, routing citizen complaints directly to the concerned official's email/office based on category and ward.
