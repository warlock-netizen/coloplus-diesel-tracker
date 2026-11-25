-- Seed the 14 active sites into public.sites
insert into public.sites (
  site_id, tenant_id, state, address, fse_name, fse_phone, security_name, security_phone, power_source, grid_status, load_kw, tank_cap, current_dl, cpd, last_supply_qty, last_supply_date, supplier, is_active
) values
  ('CP/CP/CR/001', 'CR0761 (Airtel)', 'Cross River', '46 Orok Orok St, Unical, Calabar', 'Etim Effiong', '08086603364', 'Eyibio Effiong (CLO)', '07065529932', 'In-house', 'Non PHCN', 5.4, 1000, 160, 40, 300, '2026-10-10', 'Auwal', true),
  ('CP/CP/DE/002', 'DL1010 (Airtel)', 'Delta', 'Austine Okonkwo Cl, Umuagu, Asaba', 'Lawani Maurice', '09160185834', 'Peter Odinma (CLO)', '09024024245', 'In-house', 'On GRID (Partial)', 8.3, 1200, 170, 55.9, 500, '2026-10-05', 'Auwal', true),
  ('CP/CP/DE/004', 'DL0637 (Airtel)', 'Delta', 'Kingdom Hall Rd, Warri, Delta', 'Lawani Maurice', '09160185834', 'Chuks Ogwaszi Godwin (CLO)', '09024024245', 'In-house', 'Non PHCN', 6.1, 1200, 530, 48, 600, '2026-10-08', 'Jamruq', true),
  ('CP/CP/ED/001', 'ED1179 (Airtel)', 'Edo', 'Trumpet of Zion, Auchi, Edo', 'Steven Egbuwaohia', '08066918855', 'Chief Isa Iyamah (CLO)', '08061170814', 'In-house', 'Non PHCN', 6.2, 1000, 186, 48, 400, '2026-10-04', 'Auwal', true),
  ('CP/NA/EN/276', 'EN0694 (Airtel)', 'Enugu', 'Independence Layout, Enugu', 'Ejiofor Nnamdi', '07038842986', 'Ezrah Peter (CLO)', '08168854062', 'In-house', 'On GRID', 4.5, 1000, 521, 35, 500, '2026-10-08', 'Expedient', true),
  ('CP/CP/EK/002', 'EK0474 (Airtel)', 'Ekiti', 'Housing Estate, Ado Ekiti', 'Opeyemi Lawani', '09160185834', 'Site Guard', '08031234567', 'In-house', 'Non PHCN', 6.5, 1000, 140, 55, 410, '2026-10-16', 'Auwal', true),
  ('CP/SA/LA/002', 'HP_LG_566 (Eleganza)', 'Lagos', 'Adeyemo Alakija St, Victoria Island', 'Idowu Awonusi', '08039876543', 'VI Corporate Watch', '08011223344', 'In-house', 'On GRID', 14, 2000, 140, 102.9, 800, '2026-10-10', 'Auwal', true),
  ('CP/SF/LA/048', 'LG5140 (Airtel)', 'Lagos', 'Herbert Macaulay, Yaba, Lagos', 'Wale Babatunde', '08023456789', 'Bayo Security', '08033221100', 'Partner', 'On GRID', 5.2, 1200, 427, 46, 600, '2026-10-10', 'Expedient', true),
  ('CP/CP/LA/025', 'OG1436 (Airtel)', 'Lagos', 'Magboro Outskirts, Ogun/Lagos', 'Idowu Awonusi', '08039876543', 'Security Desk', '08088776655', 'In-house', 'On GRID', 3.5, 3000, 650, 20, 1000, '2026-10-05', 'Auwal', true),
  ('CP/CP/OG/001', 'OG1820 (Airtel)', 'Ogun', 'Sagamu Expressway, Ogun', 'John Joseph', '08034567890', 'Ogun State Guard', '08099887766', 'In-house', 'Non PHCN', 5.8, 1000, 890, 42, 1000, '2026-10-15', 'Auwal', true),
  ('CP/NA/LA/021', 'OG1435 (Airtel)', 'Ogun', 'Agbara Industrial Rd, Ogun', 'John Joseph', '08034567890', 'Adeyemi Watch', '08077665544', 'In-house', 'On GRID (Partial)', 5.7, 1200, 310, 51.4, 500, '2026-10-12', 'Auwal', true),
  ('CP/NA/FC/028', 'AB1845 (MTN)', 'Abuja FCT', 'Maitama Extension, Abuja FCT', 'Suleiman Garba', '08108903624', 'Aliyu Usman', '08055667788', 'In-house', 'On GRID', 7, 1000, 850, 47, 1000, '2026-10-19', 'Auwal', true),
  ('CP/CP/BR/001', 'BR2615 (MTN)', 'Borno', 'Army Univ Campus, Biu, Borno', 'Shugaba Mohammed', '08029876543', 'Biu Gate Security', '08044556677', 'In-house', 'Non PHCN', 6, 850, 150, 48, 450, '2026-10-18', 'Auwal / Rospee', true),
  ('CP/CP/KD/002', 'KD0737 (Airtel)', 'Kaduna', 'ABU Phase 2, Zaria, Kaduna', 'Moses Nuhu', '08031234567', 'Ibrahim Tanko', '08022334455', 'In-house', 'Non PHCN', 6.8, 1000, 1086, 47, 1000, '2026-10-18', 'Auwal', true)
on conflict (site_id) do update set
  tenant_id = excluded.tenant_id,
  state = excluded.state,
  address = excluded.address,
  fse_name = excluded.fse_name,
  fse_phone = excluded.fse_phone,
  current_dl = excluded.current_dl,
  cpd = excluded.cpd,
  is_active = true;
