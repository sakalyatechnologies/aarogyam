-- The shared medicine list doctors prescribe from: generic names with a strength, a form and a
-- usual dose. Not clinic data, so every clinic reads the same rows. Sakalya maintains it; a
-- licensed Indian drug database replaces it in phase 2. allergy_classes lets the allergy check
-- match "penicillin" to amoxicillin.
set local lock_timeout = '5s';

create table aarogyam.drug_catalog (
  id uuid primary key default app.uuid_v7(),
  generic_name text not null check (char_length(btrim(generic_name)) between 2 and 200),
  brand_name text check (char_length(btrim(brand_name)) between 1 and 120),
  strength text not null check (char_length(strength) between 1 and 60),
  form text not null check (form in ('tablet', 'capsule', 'syrup', 'suspension', 'drops', 'gel', 'paste',
                                     'cream', 'ointment', 'mouthwash', 'gargle', 'lozenge', 'spray',
                                     'solution', 'injection', 'toothpaste', 'mouth_paint')),
  default_dose text not null check (char_length(default_dose) between 1 and 60),
  default_frequency text not null check (char_length(default_frequency) between 1 and 40),
  default_timing text check (default_timing in ('before_food', 'after_food', 'empty_stomach', 'bedtime', 'sos', 'as_directed')),
  default_duration_days smallint check (default_duration_days between 1 and 365),
  allergy_classes text[] not null default '{}',
  search_text text not null generated always as
    (lower(generic_name || ' ' || coalesce(brand_name, '') || ' ' || strength)) stored,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (generic_name, strength, form)
);
comment on table aarogyam.drug_catalog is 'sensitivity=public offline=read_only lifecycle=mutable';
alter table aarogyam.drug_catalog enable row level security;
create trigger set_row_times before insert or update on aarogyam.drug_catalog
  for each row execute function app.set_row_times();
create trigger audit after insert or update or delete on aarogyam.drug_catalog
  for each row execute function app.audit_row();
grant select on aarogyam.drug_catalog to app_user;
create policy readable on aarogyam.drug_catalog for select to app_user using (true);
insert into audit.audit_config (table_name, metadata_only) values ('aarogyam.drug_catalog', true);

insert into aarogyam.drug_catalog
  (generic_name, strength, form, default_dose, default_frequency, default_timing, default_duration_days, allergy_classes)
values
  -- Antibiotics
  ('Amoxicillin', '500 mg', 'capsule', '1 capsule', '1-1-1', 'after_food', 5, '{penicillin,beta_lactam}'),
  ('Amoxicillin', '250 mg', 'capsule', '1 capsule', '1-1-1', 'after_food', 5, '{penicillin,beta_lactam}'),
  ('Amoxicillin', '125 mg/5 ml', 'syrup', '5 ml', '1-1-1', 'after_food', 5, '{penicillin,beta_lactam}'),
  ('Amoxicillin + Clavulanic acid', '625 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{penicillin,beta_lactam}'),
  ('Amoxicillin + Clavulanic acid', '375 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 5, '{penicillin,beta_lactam}'),
  ('Amoxicillin + Clavulanic acid', '228.5 mg/5 ml', 'suspension', '5 ml', '1-0-1', 'after_food', 5, '{penicillin,beta_lactam}'),
  ('Ampicillin', '500 mg', 'capsule', '1 capsule', '1-1-1-1', 'empty_stomach', 5, '{penicillin,beta_lactam}'),
  ('Cefadroxil', '500 mg', 'capsule', '1 capsule', '1-0-1', 'after_food', 5, '{cephalosporin,beta_lactam}'),
  ('Cefuroxime axetil', '500 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{cephalosporin,beta_lactam}'),
  ('Cefixime', '200 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{cephalosporin,beta_lactam}'),
  ('Cephalexin', '500 mg', 'capsule', '1 capsule', '1-1-1', 'after_food', 5, '{cephalosporin,beta_lactam}'),
  ('Azithromycin', '500 mg', 'tablet', '1 tablet', '1-0-0', 'empty_stomach', 3, '{macrolide}'),
  ('Azithromycin', '250 mg', 'tablet', '1 tablet', '1-0-0', 'empty_stomach', 5, '{macrolide}'),
  ('Azithromycin', '200 mg/5 ml', 'suspension', '5 ml', '1-0-0', 'empty_stomach', 3, '{macrolide}'),
  ('Clarithromycin', '500 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{macrolide}'),
  ('Erythromycin', '500 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 5, '{macrolide}'),
  ('Clindamycin', '300 mg', 'capsule', '1 capsule', '1-1-1', 'after_food', 5, '{lincosamide}'),
  ('Clindamycin', '150 mg', 'capsule', '1 capsule', '1-1-1', 'after_food', 5, '{lincosamide}'),
  ('Metronidazole', '400 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 5, '{nitroimidazole}'),
  ('Metronidazole', '200 mg/5 ml', 'suspension', '5 ml', '1-1-1', 'after_food', 5, '{nitroimidazole}'),
  ('Tinidazole', '500 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{nitroimidazole}'),
  ('Ornidazole', '500 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{nitroimidazole}'),
  ('Doxycycline', '100 mg', 'capsule', '1 capsule', '1-0-1', 'after_food', 7, '{tetracycline}'),
  ('Ciprofloxacin', '500 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{fluoroquinolone}'),
  ('Ofloxacin + Ornidazole', '200 mg + 500 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{fluoroquinolone,nitroimidazole}'),
  ('Amoxicillin + Metronidazole', '500 mg + 400 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 5, '{penicillin,beta_lactam,nitroimidazole}'),
  -- Pain and inflammation
  ('Paracetamol', '500 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 3, '{paracetamol}'),
  ('Paracetamol', '650 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 3, '{paracetamol}'),
  ('Paracetamol', '250 mg/5 ml', 'syrup', '5 ml', '1-1-1', 'after_food', 3, '{paracetamol}'),
  ('Paracetamol', '120 mg/5 ml', 'syrup', '5 ml', '1-1-1', 'after_food', 3, '{paracetamol}'),
  ('Ibuprofen', '400 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 3, '{nsaid}'),
  ('Ibuprofen', '200 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 3, '{nsaid}'),
  ('Ibuprofen', '100 mg/5 ml', 'suspension', '5 ml', '1-1-1', 'after_food', 3, '{nsaid}'),
  ('Ibuprofen + Paracetamol', '400 mg + 325 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 3, '{nsaid,paracetamol}'),
  ('Diclofenac sodium', '50 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{nsaid}'),
  ('Diclofenac + Paracetamol', '50 mg + 325 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{nsaid,paracetamol}'),
  ('Diclofenac + Paracetamol + Serratiopeptidase', '50 mg + 325 mg + 15 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{nsaid,paracetamol}'),
  ('Aceclofenac', '100 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{nsaid}'),
  ('Aceclofenac + Paracetamol', '100 mg + 325 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{nsaid,paracetamol}'),
  ('Aceclofenac + Paracetamol + Serratiopeptidase', '100 mg + 325 mg + 15 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{nsaid,paracetamol}'),
  ('Aceclofenac + Paracetamol + Chlorzoxazone', '100 mg + 325 mg + 250 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{nsaid,paracetamol}'),
  ('Ketorolac tromethamine', '10 mg', 'tablet', '1 tablet', '1-0-1', 'sos', 3, '{nsaid}'),
  ('Mefenamic acid', '500 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 3, '{nsaid}'),
  ('Mefenamic acid + Paracetamol', '100 mg + 250 mg/5 ml', 'suspension', '5 ml', '1-1-1', 'after_food', 3, '{nsaid,paracetamol}'),
  ('Naproxen', '250 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{nsaid}'),
  ('Nimesulide', '100 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{nsaid}'),
  ('Etoricoxib', '90 mg', 'tablet', '1 tablet', '1-0-0', 'after_food', 3, '{nsaid,cox2_inhibitor}'),
  ('Etoricoxib', '60 mg', 'tablet', '1 tablet', '1-0-0', 'after_food', 3, '{nsaid,cox2_inhibitor}'),
  ('Celecoxib', '200 mg', 'capsule', '1 capsule', '1-0-1', 'after_food', 3, '{nsaid,cox2_inhibitor,sulfonamide}'),
  ('Tramadol', '50 mg', 'capsule', '1 capsule', '1-0-1', 'sos', 3, '{opioid}'),
  ('Tramadol + Paracetamol', '37.5 mg + 325 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{opioid,paracetamol}'),
  ('Serratiopeptidase', '10 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 5, '{}'),
  ('Trypsin + Chymotrypsin', '100000 AU', 'tablet', '1 tablet', '1-1-1', 'empty_stomach', 5, '{}'),
  ('Prednisolone', '10 mg', 'tablet', '1 tablet', '1-0-0', 'after_food', 5, '{corticosteroid}'),
  ('Dexamethasone', '4 mg', 'tablet', '1 tablet', '1-0-0', 'after_food', 3, '{corticosteroid}'),
  ('Methylprednisolone', '8 mg', 'tablet', '1 tablet', '1-0-0', 'after_food', 5, '{corticosteroid}'),
  -- Stomach protection
  ('Pantoprazole', '40 mg', 'tablet', '1 tablet', '1-0-0', 'before_food', 5, '{proton_pump_inhibitor}'),
  ('Omeprazole', '20 mg', 'capsule', '1 capsule', '1-0-0', 'before_food', 5, '{proton_pump_inhibitor}'),
  ('Rabeprazole', '20 mg', 'tablet', '1 tablet', '1-0-0', 'before_food', 5, '{proton_pump_inhibitor}'),
  ('Esomeprazole', '40 mg', 'tablet', '1 tablet', '1-0-0', 'before_food', 5, '{proton_pump_inhibitor}'),
  ('Pantoprazole + Domperidone', '40 mg + 30 mg', 'capsule', '1 capsule', '1-0-0', 'before_food', 5, '{proton_pump_inhibitor}'),
  ('Famotidine', '20 mg', 'tablet', '1 tablet', '1-0-1', 'before_food', 5, '{}'),
  ('Domperidone', '10 mg', 'tablet', '1 tablet', '1-0-1', 'before_food', 3, '{}'),
  ('Ondansetron', '4 mg', 'tablet', '1 tablet', '1-0-1', 'sos', 2, '{}'),
  -- Antifungals and antivirals
  ('Fluconazole', '150 mg', 'tablet', '1 tablet', '1-0-0', 'after_food', 7, '{azole}'),
  ('Clotrimazole', '1%', 'mouth_paint', 'Apply', '1-1-1', 'after_food', 14, '{azole}'),
  ('Clotrimazole', '10 mg', 'lozenge', '1 lozenge', '1-1-1-1-1', 'after_food', 14, '{azole}'),
  ('Miconazole', '2%', 'gel', 'Apply', '1-1-1-1', 'after_food', 14, '{azole}'),
  ('Nystatin', '100000 IU/ml', 'suspension', '1 ml', '1-1-1-1', 'after_food', 14, '{}'),
  ('Acyclovir', '400 mg', 'tablet', '1 tablet', '1-1-1-1-1', 'after_food', 5, '{}'),
  ('Acyclovir', '800 mg', 'tablet', '1 tablet', '1-1-1-1-1', 'after_food', 7, '{}'),
  ('Acyclovir', '5%', 'cream', 'Apply', '1-1-1-1-1', 'as_directed', 5, '{}'),
  ('Valacyclovir', '1 g', 'tablet', '1 tablet', '1-0-1', 'after_food', 7, '{}'),
  -- Mouth care and local applications
  ('Chlorhexidine gluconate', '0.2%', 'mouthwash', '10 ml', '1-0-1', 'after_food', 14, '{chlorhexidine}'),
  ('Chlorhexidine gluconate', '0.12%', 'mouthwash', '15 ml', '1-0-1', 'after_food', 14, '{chlorhexidine}'),
  ('Povidone-iodine', '2%', 'gargle', '10 ml', '1-1-1', 'after_food', 7, '{iodine}'),
  ('Benzydamine hydrochloride', '0.15%', 'mouthwash', '15 ml', '1-1-1', 'after_food', 7, '{}'),
  ('Hexetidine', '0.1%', 'mouthwash', '15 ml', '1-0-1', 'after_food', 7, '{}'),
  ('Cetylpyridinium chloride', '0.05%', 'mouthwash', '15 ml', '1-0-1', 'after_food', 14, '{}'),
  ('Sodium fluoride', '0.05%', 'mouthwash', '10 ml', '0-0-1', 'bedtime', 30, '{}'),
  ('Lignocaine', '2%', 'gel', 'Apply', '1-1-1', 'sos', 5, '{amide_anaesthetic}'),
  ('Benzocaine', '20%', 'gel', 'Apply', '1-1-1', 'sos', 5, '{ester_anaesthetic}'),
  ('Choline salicylate + Lignocaine', '8.7% + 2%', 'gel', 'Apply', '1-1-1', 'after_food', 7, '{salicylate,amide_anaesthetic}'),
  ('Triamcinolone acetonide', '0.1%', 'paste', 'Apply', '1-0-1', 'after_food', 7, '{corticosteroid}'),
  ('Amlexanox', '5%', 'paste', 'Apply', '1-1-1-1', 'after_food', 7, '{}'),
  ('Metronidazole + Chlorhexidine', '1% + 0.25%', 'gel', 'Apply', '1-0-1', 'after_food', 7, '{nitroimidazole,chlorhexidine}'),
  ('Hyaluronic acid', '0.2%', 'gel', 'Apply', '1-1-1', 'after_food', 14, '{}'),
  ('Tannic acid + Glycerin', 'gum paint', 'mouth_paint', 'Apply', '1-0-1', 'after_food', 14, '{}'),
  ('Potassium nitrate', '5%', 'toothpaste', 'Brush', '1-0-1', 'as_directed', 30, '{}'),
  ('Calcium sodium phosphosilicate', '5%', 'toothpaste', 'Brush', '1-0-1', 'as_directed', 30, '{}'),
  ('Stannous fluoride', '0.4%', 'gel', 'Apply', '0-0-1', 'bedtime', 30, '{}'),
  ('Carboxymethylcellulose', 'saliva substitute', 'spray', '2 sprays', 'SOS', 'sos', 30, '{}'),
  ('Hydrogen peroxide', '1.5%', 'mouthwash', '10 ml', '1-0-1', 'after_food', 7, '{}'),
  -- Vitamins and supplements
  ('Vitamin B complex + Vitamin C', 'standard', 'capsule', '1 capsule', '1-0-0', 'after_food', 15, '{}'),
  ('Multivitamin + Antioxidants', 'standard', 'capsule', '1 capsule', '0-0-1', 'after_food', 30, '{}'),
  ('Ascorbic acid', '500 mg', 'tablet', '1 tablet', '1-0-0', 'after_food', 15, '{}'),
  ('Folic acid', '5 mg', 'tablet', '1 tablet', '1-0-0', 'after_food', 30, '{}'),
  ('Calcium carbonate + Vitamin D3', '500 mg + 250 IU', 'tablet', '1 tablet', '0-0-1', 'after_food', 30, '{}'),
  ('Methylcobalamin', '1500 mcg', 'tablet', '1 tablet', '1-0-0', 'after_food', 30, '{}'),
  -- Allergy, anxiety, bleeding and nerve pain
  ('Cetirizine', '10 mg', 'tablet', '1 tablet', '0-0-1', 'bedtime', 5, '{antihistamine}'),
  ('Levocetirizine', '5 mg', 'tablet', '1 tablet', '0-0-1', 'bedtime', 5, '{antihistamine}'),
  ('Chlorpheniramine maleate', '4 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 3, '{antihistamine}'),
  ('Alprazolam', '0.25 mg', 'tablet', '1 tablet', '0-0-1', 'bedtime', 1, '{benzodiazepine}'),
  ('Diazepam', '5 mg', 'tablet', '1 tablet', '0-0-1', 'bedtime', 1, '{benzodiazepine}'),
  ('Tranexamic acid', '500 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 3, '{}'),
  ('Carbamazepine', '200 mg', 'tablet', '1 tablet', '1-0-1', 'after_food', 14, '{}'),
  ('Pregabalin', '75 mg', 'capsule', '1 capsule', '0-0-1', 'bedtime', 14, '{}'),
  ('Gabapentin', '300 mg', 'capsule', '1 capsule', '0-0-1', 'bedtime', 14, '{}'),
  ('Pilocarpine', '5 mg', 'tablet', '1 tablet', '1-1-1', 'after_food', 30, '{}');
