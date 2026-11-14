# ruff: noqa: E501  (CSV rows cannot be wrapped)
"""HAND-MADE TEST DATA for exofinder.data unit tests — NOT real catalogue snapshots.

A few rows copy published values for Kepler-2 and Kepler-90 (NASA Exoplanet Archive tables
q1_q17_dr24_tce, cumulative, pscomppars+keplernames, keplerstellar; retrieved 2026-11-14) so tests use
realistic numbers. All other rows are INVENTED (kepids 1000001-1000010, KOI names K9xxxx.xx, planet
names "Kepler-Tn x") to exercise specific matching / category / conflict edge cases.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
#: Real Kepler long-cadence FITS files (public NASA data).
KEPLER2_Q2 = FIXTURES / "kplr010666592-2009259160929_llc.fits"
KEPLER2_Q3 = FIXTURES / "kplr010666592-2009350155506_llc.fits"
KEPLER90_Q3 = FIXTURES / "kplr011442793-2009350155506_llc.fits"

# --------------------------------------------------------------------------------------------------
TCE_CSV = textwrap.dedent(
    """\
    kepid,tce_plnt_num,tce_period,tce_period_err,tce_time0bk,tce_time0bk_err,tce_duration,tce_duration_err,tce_depth,tce_depth_err,tce_model_snr,tce_prad,tce_num_transits,ra,dec,av_training_set
    1000001,1,10.0,1e-5,135.0,0.001,3.0,0.1,500,10,30,2.0,120,290.0,45.0,"AFP"
    1000001,2,20.0,1e-5,140.0,0.001,4.0,0.1,800,10,40,2.5,60,290.0,45.0,"PC"
    1000002,1,5.0,1e-5,131.0,0.001,2.0,0.1,300,10,20,1.5,250,291.0,46.0,"NTP"
    1000003,1,7.0,1e-5,133.0,0.001,2.5,0.1,200,10,12,1.2,180,292.0,47.0,"UNK"
    1000004,1,3.0,1e-5,132.0,0.001,2.0,0.1,1000,10,50,3.0,400,293.0,48.0,"PC"
    1000005,1,12.0,1e-5,140.0,0.001,5.0,0.1,700,10,35,2.2,100,294.0,49.0,"AFP"
    1000006,1,4.0,1e-5,131.5,0.001,2.0,0.1,400,10,25,1.8,300,295.0,40.0,"PC"
    1000007,1,6.0,1e-5,132.0,0.001,3.0,0.1,600,10,28,2.1,200,296.0,41.0,"PC"
    1000007,2,9.0,1e-5,134.0,0.001,3.0,0.1,650,10,29,2.1,140,296.0,41.0,"PC"
    1000008,1,15.0,1e-5,140.0,0.001,4.0,0.1,900,10,45,2.8,90,297.0,42.0,"PC"
    1000009,1,50.0,1e-5,150.0,0.001,6.0,0.1,1200,10,60,3.5,25,298.0,43.0,"PC"
    1000010,1,11.391,1e-5,137.705,0.001,2.5,0.1,350,10,22,1.6,110,299.0,44.0,"PC"
    10666592,1,2.20474,1e-6,132.381,0.0001,3.86,0.01,6704,5,3715,16.9,600,292.24728,47.969521,"PC"
    10666592,2,2.20475,1e-5,133.479,0.001,4.5,0.1,48.74,3,-1,1.5,600,292.24728,47.969521,"AFP"
    11442793,1,331.603,0.01,140.48,0.01,14.49,0.1,8365,30,225,11.0,4,284.4335,49.305161,"PC"
    """
)

KOI_HEADER = (
    "kepid,kepoi_name,kepler_name,koi_disposition,koi_pdisposition,koi_score,koi_fpflag_nt,koi_fpflag_ss,"
    "koi_fpflag_co,koi_fpflag_ec,koi_disp_prov,koi_vet_stat,koi_vet_date,koi_period,koi_period_err1,"
    "koi_time0bk,koi_time0bk_err1,koi_duration,koi_duration_err1,koi_depth,koi_depth_err1,koi_model_snr,"
    "koi_prad,koi_tce_plnt_num,koi_tce_delivname,ra,dec,koi_kepmag"
)
KOI_CSV = (
    KOI_HEADER
    + "\n"
    + textwrap.dedent(
        """\
    10666592,"K00002.01","Kepler-2 b","CONFIRMED","CANDIDATE",1.0,0,0,0,0,"Q1-Q17 DR25","Done","2018-08-16",2.204735417,1e-8,121.3585417,2e-6,3.88864,0.0002,6674.7,0.4,5945.9,16.06,1,"q1_q17_dr25_tce",292.24728,47.969521,10.463
    11442793,"K00351.01","Kepler-90 h","CONFIRMED","CANDIDATE",0.0,0,0,0,0,"Q1-Q17 DR25","Done","2018-08-16",331.5972732,1e-4,140.498929,4e-4,14.404,0.02,8322.1,20,256.0,11.32,1,"q1_q17_dr25_tce",284.4335,49.305161,13.804
    11442793,"K00351.02","Kepler-90 g","CONFIRMED","CANDIDATE",0.88,0,0,0,0,"Q1-Q17 DR25","Done","2018-08-16",210.6013843,1e-4,147.056867,8e-4,11.9922,0.05,4159.3,30,100.0,8.13,2,"q1_q17_dr25_tce",284.4335,49.305161,13.804
    1000004,"K90004.01",,"FALSE POSITIVE","FALSE POSITIVE",0.0,0,1,0,0,"Test","Done","2018-08-16",3.00001,1e-5,132.0,0.001,2.0,0.1,1000,10,50,3.0,1,"q1_q17_dr25_tce",293.0,48.0,14.0
    1000005,"K90005.01","Kepler-T5 b","CONFIRMED","CANDIDATE",0.99,0,0,0,0,"Test","Done","2018-08-16",12.0001,1e-5,152.0,0.001,5.1,0.1,700,10,35,2.2,1,"q1_q17_dr24_tce",294.0,49.0,14.0
    1000006,"K90006.01",,"CANDIDATE","CANDIDATE",0.7,0,0,0,0,"Test","Done","2018-08-16",8.0,1e-5,131.5,0.001,2.0,0.1,400,10,25,1.8,1,"q1_q17_dr25_tce",295.0,40.0,14.0
    1000007,"K90007.01",,"CANDIDATE","CANDIDATE",0.8,0,0,0,0,"Test","Done","2018-08-16",6.0001,1e-5,150.0,0.001,3.0,0.1,600,10,28,2.1,2,"q1_q17_dr25_tce",296.0,41.0,14.0
    1000007,"K90007.02",,"CANDIDATE","CANDIDATE",0.8,0,0,0,0,"Test","Done","2018-08-16",9.0002,1e-5,143.0,0.001,3.0,0.1,650,10,29,2.1,1,"q1_q17_dr25_tce",296.0,41.0,14.0
    1000008,"K90008.01",,"CANDIDATE","CANDIDATE",0.6,0,0,0,0,"Test","Done","2018-08-16",15.001,1e-5,140.3,0.001,4.0,0.1,900,10,45,2.8,1,"q1_q17_dr25_tce",297.0,42.0,14.0
    1000009,"K90009.01",,"CANDIDATE","CANDIDATE",0.9,0,0,0,0,"Test","Done","2018-08-16",50.0005,1e-5,150.01,0.001,6.0,0.1,1200,10,60,3.5,1,"q1_q16_tce",298.0,43.0,14.0
    1000009,"K90009.02",,"CANDIDATE","CANDIDATE",0.5,0,0,0,0,"Test","Done","2018-08-16",33.0,1e-5,160.0,0.001,5.0,0.1,100,10,9,1.0,,,298.0,43.0,14.0
    1000010,"K90010.01",,"CONFIRMED","CANDIDATE",1.0,0,0,0,0,"Test","Done","2018-08-16",11.391,1e-5,137.705,0.001,2.5,0.1,350,10,22,1.6,1,"q1_q17_dr25_tce",299.0,44.0,14.0
    1000010,"K90010.02",,"CANDIDATE","CANDIDATE",0.4,0,0,0,0,"Test","Done","2018-08-16",11.3911,1e-5,137.70,0.001,2.5,0.1,350,10,22,1.6,1,"q1_q16_tce",299.0,44.0,14.0
    """
    )
)

CONFIRMED_CSV = textwrap.dedent(
    """\
    kepid,kepler_name,koi_name,pl_name,hostname,pl_letter,pl_orbper,pl_orbpererr1,pl_tranmid,pl_tranmiderr1,pl_tranmid_systemref,pl_trandur,pl_trandep,pl_rade,tran_flag,disc_facility,discoverymethod,disc_year,ra,dec,sy_kepmag
    "10666592","Kepler-2 b","K00002.01","HAT-P-7 b","HAT-P-7","b",2.20474,1e-6,2454954.358572,1e-4,"BJD",3.88216,0.6,16.92559,1,"HATNet","Transit",2008,292.24719,47.9695429,10.463
    "11442793","Kepler-90 g","K00351.02","KOI-351 g","KOI-351","g",210.73514,1e-3,2454979.97608,1e-3,"JD",12.32,0.38,7.718,1,"Kepler","Transit",2013,284.4334642,49.3051239,13.804
    "11442793","Kepler-90 h","K00351.01","KOI-351 h","KOI-351","h",331.60296,1e-3,2454973.50056,1e-3,"JD",14.404,0.83221,11.252,1,"Kepler","Transit",2013,284.4334642,49.3051239,13.804
    "11442793","Kepler-90 i",,"Kepler-90 i","KOI-351","i",14.44912,1e-4,2455644.3488,1e-3,"BJD",2.8,,1.32,1,"Kepler","Transit",2017,284.4334642,49.3051239,13.804
    "1000002","Kepler-T2 b",,"Kepler-T2 b","Kepler-T2","b",5.0001,1e-5,2455464.0,1e-3,"BJD",2.0,0.03,1.5,1,"Kepler","Transit",2016,291.0,46.0,14.0
    "1000003","Kepler-T3 b",,"Kepler-T3 b","Kepler-T3","b",77.0,1e-3,2455000.0,1e-3,"BJD",,0.01,1.0,1,"Kepler","Transit",2016,292.0,47.0,14.0
    "1000005","Kepler-T5 b","K90005.01","Kepler-T5 b","Kepler-T5","b",12.0001,1e-5,2454985.0,1e-3,"BJD",5.1,0.07,2.2,1,"Kepler","Transit",2016,294.0,49.0,14.0
    "1000009","Kepler-T9 c",,"Kepler-T9 c","Kepler-T9","c",300.0,1.0,,,,,,,0,"Kepler","Transit Timing Variations",2016,298.0,43.0,14.0
    """
)

STELLAR_CSV = textwrap.dedent(
    """\
    kepid,teff,logg,feh,radius,mass,dens,kepmag,ra,dec,prov_sec,st_delivname
    10666592,6440,4.019,0.26,1.952,1.449,0.27,10.463,292.247280,47.969521,"DSEP","q1_q17_dr25_stellar"
    11442793,5970,4.317,0.08,1.200,1.089,0.88,13.804,284.433500,49.305161,"DSEP","q1_q17_dr25_stellar"
    1000001,5500,4.5,0.0,0.9,0.95,1.5,14.0,290.0,45.0,"DSEP","q1_q17_dr25_stellar"
    """
)
