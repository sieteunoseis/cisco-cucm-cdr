CREATE TABLE cdr
(
  cdrrecordtype integer,
  globalcallid_callmanagerid integer,
  globalcallid_callid integer,
  origlegcallidentifier integer,
  datetimeorigination timestamp without time zone,
  orignodeid integer,
  origspan integer,
  origipaddr inet,
  callingpartynumber text,
  callingpartyunicodeloginuserid text,
  origcause_location integer,
  origcause_value integer,
  origprecedencelevel integer,
  origmediatransportaddress_ip inet,
  origmediatransportaddress_port integer,
  origmediacap_payloadcapability integer,
  origmediacap_maxframesperpacket integer,
  origmediacap_g723bitrate integer,
  origvideocap_codec integer,
  origvideocap_bandwidth integer,
  origvideocap_resolution integer,
  origvideotransportaddress_ip inet,
  origvideotransportaddress_port integer,
  origrsvpaudiostat text,
  origrsvpvideostat text,
  destlegidentifier integer,
  destnodeid integer,
  destspan integer,
  destipaddr inet,
  originalcalledpartynumber text,
  finalcalledpartynumber text,
  finalcalledpartyunicodeloginuserid text,
  destcause_location integer,
  destcause_value integer,
  destprecedencelevel integer,
  destmediatransportaddress_ip inet,
  destmediatransportaddress_port integer,
  destmediacap_payloadcapability integer,
  destmediacap_maxframesperpacket integer,
  destmediacap_g723bitrate integer,
  destvideocap_codec integer,
  destvideocap_bandwidth integer,
  destvideocap_resolution integer,
  destvideotransportaddress_ip inet,
  destvideotransportaddress_port integer,
  destrsvpaudiostat text,
  destrsvpvideostat text,
  datetimeconnect timestamp without time zone,
  datetimedisconnect timestamp without time zone,
  lastredirectdn text,
  pkid uuid NOT NULL,
  originalcalledpartynumberpartition text,
  callingpartynumberpartition text,
  finalcalledpartynumberpartition text,
  lastredirectdnpartition text,
  duration interval,
  origdevicename text,
  destdevicename text,
  origcallterminationonbehalfof integer,
  destcallterminationonbehalfof integer,
  origcalledpartyredirectonbehalfof integer,
  lastredirectredirectonbehalfof integer,
  origcalledpartyredirectreason integer,
  lastredirectredirectreason integer,
  destconversationid integer,
  globalcallid_clusterid text,
  joinonbehalfof integer,
  comment text,
  authcodedescription text,
  authorizationlevel integer,
  clientmattercode text,
  origdtmfmethod integer,
  destdtmfmethod integer,
  callsecuredstatus integer,
  origconversationid integer,
  origmediacap_bandwidth integer,
  destmediacap_bandwidth integer,
  authorizationcodevalue text,
  outpulsedcallingpartynumber text,
  outpulsedcalledpartynumber text,
  origipv4v6addr inet,
  destipv4v6addr inet,
  origvideocap_codec_channel2 integer,
  origvideocap_bandwidth_channel2 integer,
  origvideocap_resolution_channel2 integer,
  origvideotransportaddress_ip_channel2 inet,
  origvideotransportaddress_port_channel2 integer,
  origvideochannel_role_channel2 integer,
  destvideocap_codec_channel2 integer,
  destvideocap_bandwidth_channel2 integer,
  destvideocap_resolution_channel2 integer,
  destvideotransportaddress_ip_channel2 inet,
  destvideotransportaddress_port_channel2 integer,
  destvideochannel_role_channel2 integer,
  incomingprotocolid integer,
  incomingprotocolcallref text,
  outgoingprotocolid integer,
  outgoingprotocolcallref text,
  currentroutingreason integer,
  origroutingreason integer,
  lastredirectingroutingreason integer,
  huntpilotpartition text,
  huntpilotdn text,
  calledpartypatternusage integer,
  incomingicid text,
  incomingorigioi text,
  incomingtermioi text,
  outgoingicid text,
  outgoingorigioi text,
  outgoingtermioi text,
  outpulsedoriginalcalledpartynumber text,
  outpulsedlastredirectingnumber text,
  CONSTRAINT cdr_pkid PRIMARY KEY (pkid)
)
WITH (OIDS=FALSE);

ALTER TABLE cdr SET (autovacuum_enabled = false);

CREATE TABLE cmr
(
  cdrrecordtype integer,
  globalcallid_callmanagerid integer,
  globalcallid_callid integer,
  nodeid integer,
  directorynum text,
  callidentifier integer,
  datetimestamp timestamp without time zone,
  numberpacketssent integer,
  numberoctetssent integer,
  numberpacketsreceived integer,
  numberoctetsreceived integer,
  numberpacketslost integer,
  jitter integer,
  latency integer,
  pkid uuid NOT NULL,
  directorynumpartition text,
  globalcallid_clusterid text,
  devicename text,
  moslqk real,
  moslqkavg real,
  moslqkmin real,
  moslqkmax real,
  intervalconcealratio real,
  cumulativeconcealratio real,
  intervalconcealratiomax real,
  concealsecs real,
  severelyconcealsecs real,
  CONSTRAINT cmr_pkid PRIMARY KEY (pkid)
)
WITH (OIDS=FALSE);

ALTER TABLE cmr SET (autovacuum_enabled = false);


CREATE TABLE cdr_cause (
    id bigint NOT NULL,
    description text
);

ALTER TABLE ONLY cdr_cause
    ADD CONSTRAINT cdr_cause_pkey PRIMARY KEY (id);


CREATE TABLE cdr_codec (
    id integer NOT NULL,
    description text
);


ALTER TABLE ONLY cdr_codec
    ADD CONSTRAINT cdr_codec_pkey PRIMARY KEY (id);


CREATE TABLE cdr_onbehalfof (
    id integer NOT NULL,
    description text
);

ALTER TABLE ONLY cdr_onbehalfof
    ADD CONSTRAINT cdr_onbehalfof_pkey PRIMARY KEY (id);


CREATE TABLE cdr_reason (
    id integer NOT NULL,
    description text
);

ALTER TABLE ONLY cdr_reason
    ADD CONSTRAINT cdr_reason_pkey PRIMARY KEY (id);

