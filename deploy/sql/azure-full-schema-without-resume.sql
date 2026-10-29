-- =====================================================================================================
-- TT Suite: full database schema for a NEW, EMPTY Azure Database for PostgreSQL (Flexible Server)
--
-- Creates everything the suite needs before its first start:
--   * roles   app_owner (owns the schemas, runs migrations)  and  app_rw (what the apps use at runtime)
--   * schemas app (people, access, sessions), kanban, lms (Leave), expense (EMS), ams (Assets)
--   * WITHOUT the Resume Evaluator (no `resume` schema), for a suite built with SUITE_SKIP=resume
--     Generated from azure-full-schema.sql by deploy/sql/without_resume.py; do not edit by hand.
--   * every table, index, constraint, sequence and grant, exactly as the apps' own migrations make them
--   * each app's migration-version rows, so every app sees the database as up to date and changes nothing
-- No data: the apps add their reference data (leave types, categories, ...) on first start.
--
-- Generated from a freshly migrated database (pg_dump --schema-only); do not edit by hand. To refresh it
-- after new migrations, see deploy/README.md ("New Azure database").
--
-- Run ONCE, as the Azure server admin, against the empty database (default name: ttsuite):
--
--   psql "host=<server>.postgres.database.azure.com port=5432 dbname=ttsuite user=<admin> sslmode=require" \
--        -v ON_ERROR_STOP=1 -v owner_password='<strong password>' -v app_password='<strong password>' \
--        -f deploy/sql/azure-full-schema.sql
--
-- Then in the App Service settings:
--   DATABASE_OWNER_URL = postgresql://app_owner:<owner_password>@<server>.postgres.database.azure.com:5432/ttsuite?sslmode=require
--   DATABASE_URL       = postgresql://app_rw:<app_password>@<server>.postgres.database.azure.com:5432/ttsuite?sslmode=require
-- (URL-encode special characters in the passwords.)
-- Extensions: none beyond plpgsql, so nothing needs allow-listing in azure.extensions.
-- Later releases still migrate themselves on start (as app_owner); this script is only for the first setup.
-- =====================================================================================================

\set ON_ERROR_STOP on

-- ---- Part 1: roles (only created when missing; passwords come from -v, never from this file) ----------
SELECT format('CREATE ROLE app_owner LOGIN PASSWORD %L', :'owner_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') \gexec
SELECT format('CREATE ROLE app_rw LOGIN PASSWORD %L', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') \gexec
-- The admin acts as app_owner below (so app_owner owns every object, as when the apps migrate).
GRANT app_owner TO CURRENT_USER;
SELECT format('GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO app_owner', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO app_rw', current_database()) \gexec

-- Refuse to run twice (the database must be empty).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('app', 'kanban', 'lms', 'expense', 'ams', 'resume')) THEN
    RAISE EXCEPTION 'The suite schemas already exist in this database. This script is for a new, empty database only.';
  END IF;
END
$$;

BEGIN;
SET ROLE app_owner;

-- ---- Part 2: schemas, tables, indexes, constraints and grants (pg_dump --schema-only) -----------------
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ams; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA ams;


--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: expense; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA expense;


--
-- Name: kanban; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA kanban;


--
-- Name: lms; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA lms;


--
-- Name: audit_log_read_only(); Type: FUNCTION; Schema: expense; Owner: -
--

CREATE FUNCTION expense.audit_log_read_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
            RAISE EXCEPTION 'audit_log is append-only';
        END;
        $$;


--
-- Name: append_only_violation(); Type: FUNCTION; Schema: kanban; Owner: -
--

CREATE FUNCTION kanban.append_only_violation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: ams; Owner: -
--

CREATE TABLE ams.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: ams_asset_requests; Type: TABLE; Schema: ams; Owner: -
--

CREATE TABLE ams.ams_asset_requests (
    id bigint NOT NULL,
    requested_by bigint NOT NULL,
    name character varying(255) NOT NULL,
    category_id bigint,
    is_other boolean DEFAULT false NOT NULL,
    other_category_name character varying(255),
    other_reason text,
    serial_no character varying(255),
    service_tag character varying(255),
    asset_tag character varying(255),
    purchase_date date,
    cost numeric(12,2),
    location character varying(255),
    status character varying(50) NOT NULL,
    created_asset_id bigint,
    decided_by bigint,
    decision_comment text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text NOT NULL,
    requires_employee_register boolean DEFAULT false NOT NULL
);


--
-- Name: ams_asset_tag_seq; Type: SEQUENCE; Schema: ams; Owner: -
--

CREATE SEQUENCE ams.ams_asset_tag_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ams_assets; Type: TABLE; Schema: ams; Owner: -
--

CREATE TABLE ams.ams_assets (
    id bigint NOT NULL,
    tag character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    serial_no character varying(255) NOT NULL,
    category_id bigint NOT NULL,
    purchase_date date NOT NULL,
    cost numeric(12,2) NOT NULL,
    location character varying(255) NOT NULL,
    status character varying(50) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    service_tag character varying(255),
    asset_tag character varying(255),
    awaiting_employee_details boolean DEFAULT false NOT NULL
);


--
-- Name: ams_assignments; Type: TABLE; Schema: ams; Owner: -
--

CREATE TABLE ams.ams_assignments (
    id bigint NOT NULL,
    asset_id bigint NOT NULL,
    user_id bigint NOT NULL,
    assigned_on date NOT NULL,
    returned_on date,
    return_reason character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ams_categories; Type: TABLE; Schema: ams; Owner: -
--

CREATE TABLE ams.ams_categories (
    id bigint NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ams_maintenance_records; Type: TABLE; Schema: ams; Owner: -
--

CREATE TABLE ams.ams_maintenance_records (
    id bigint NOT NULL,
    asset_id bigint NOT NULL,
    replacement_request_id bigint,
    opened_on date NOT NULL,
    closed_on date,
    description text NOT NULL,
    cost numeric(12,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolution text,
    opened_by bigint
);


--
-- Name: ams_replacement_requests; Type: TABLE; Schema: ams; Owner: -
--

CREATE TABLE ams.ams_replacement_requests (
    id bigint NOT NULL,
    asset_id bigint NOT NULL,
    requested_by bigint NOT NULL,
    reason text NOT NULL,
    old_asset_action character varying(50) NOT NULL,
    temporary boolean DEFAULT false NOT NULL,
    replacement_asset_id bigint,
    status character varying(50) NOT NULL,
    decided_by bigint,
    decision_comment text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ams_users; Type: TABLE; Schema: ams; Owner: -
--

CREATE TABLE ams.ams_users (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    role character varying(50) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    suite_user_id character varying(40)
);


--
-- Name: asset_requests_id_seq; Type: SEQUENCE; Schema: ams; Owner: -
--

CREATE SEQUENCE ams.asset_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: asset_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: ams; Owner: -
--

ALTER SEQUENCE ams.asset_requests_id_seq OWNED BY ams.ams_asset_requests.id;


--
-- Name: assets_id_seq; Type: SEQUENCE; Schema: ams; Owner: -
--

CREATE SEQUENCE ams.assets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assets_id_seq; Type: SEQUENCE OWNED BY; Schema: ams; Owner: -
--

ALTER SEQUENCE ams.assets_id_seq OWNED BY ams.ams_assets.id;


--
-- Name: assignments_id_seq; Type: SEQUENCE; Schema: ams; Owner: -
--

CREATE SEQUENCE ams.assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: ams; Owner: -
--

ALTER SEQUENCE ams.assignments_id_seq OWNED BY ams.ams_assignments.id;


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: ams; Owner: -
--

CREATE SEQUENCE ams.categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: ams; Owner: -
--

ALTER SEQUENCE ams.categories_id_seq OWNED BY ams.ams_categories.id;


--
-- Name: maintenance_records_id_seq; Type: SEQUENCE; Schema: ams; Owner: -
--

CREATE SEQUENCE ams.maintenance_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: maintenance_records_id_seq; Type: SEQUENCE OWNED BY; Schema: ams; Owner: -
--

ALTER SEQUENCE ams.maintenance_records_id_seq OWNED BY ams.ams_maintenance_records.id;


--
-- Name: replacement_requests_id_seq; Type: SEQUENCE; Schema: ams; Owner: -
--

CREATE SEQUENCE ams.replacement_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: replacement_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: ams; Owner: -
--

ALTER SEQUENCE ams.replacement_requests_id_seq OWNED BY ams.ams_replacement_requests.id;


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: ams; Owner: -
--

CREATE SEQUENCE ams.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: ams; Owner: -
--

ALTER SEQUENCE ams.users_id_seq OWNED BY ams.ams_users.id;


--
-- Name: app_access; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.app_access (
    user_id text NOT NULL,
    app text NOT NULL,
    role text NOT NULL,
    source text DEFAULT 'app'::text NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_access_app_check CHECK ((app = ANY (ARRAY['kanban'::text, 'lms'::text, 'expense'::text, 'ams'::text, 'resume'::text]))),
    CONSTRAINT app_access_source_check CHECK ((source = ANY (ARRAY['global'::text, 'app'::text])))
);


--
-- Name: audit_log; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.audit_log (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id text,
    action text NOT NULL,
    target_id text,
    app text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.audit_log_id_seq OWNED BY app.audit_log.id;


--
-- Name: mail_outbox; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.mail_outbox (
    id bigint NOT NULL,
    to_email text NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT mail_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: mail_outbox_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.mail_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mail_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.mail_outbox_id_seq OWNED BY app.mail_outbox.id;


--
-- Name: message; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.message (
    id bigint NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    link text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);


--
-- Name: message_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.message_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.message_id_seq OWNED BY app.message.id;


--
-- Name: role_request; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.role_request (
    id bigint NOT NULL,
    app text NOT NULL,
    user_id text NOT NULL,
    role text,
    lead_team_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    requested_by text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by text,
    decision_note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT role_request_app_check CHECK ((app = ANY (ARRAY['kanban'::text, 'lms'::text, 'expense'::text, 'ams'::text, 'resume'::text]))),
    CONSTRAINT role_request_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'cancelled'::text])))
);


--
-- Name: role_request_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

CREATE SEQUENCE app.role_request_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: role_request_id_seq; Type: SEQUENCE OWNED BY; Schema: app; Owner: -
--

ALTER SEQUENCE app.role_request_id_seq OWNED BY app.role_request.id;


--
-- Name: schema_version; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.schema_version (
    id text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.session (
    id text NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL
);


--
-- Name: user_preference; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.user_preference (
    user_id text NOT NULL,
    preset text DEFAULT 'linen'::text NOT NULL,
    mode text DEFAULT 'system'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_preference_mode_check CHECK ((mode = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text]))),
    CONSTRAINT user_preference_preset_check CHECK ((preset = ANY (ARRAY['linen'::text, 'harbour'::text, 'graphite'::text])))
);


--
-- Name: users; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.users (
    id text NOT NULL,
    email text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    entra_oid text,
    status text DEFAULT 'invited'::text NOT NULL,
    is_global_admin boolean DEFAULT false NOT NULL,
    photo bytea,
    photo_type text,
    invited_by text,
    invited_at timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    job_title text DEFAULT ''::text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    location text DEFAULT ''::text NOT NULL,
    name_edited boolean DEFAULT false NOT NULL,
    photo_uploaded boolean DEFAULT false NOT NULL,
    employee_code text,
    CONSTRAINT users_email_check CHECK ((email = lower(email))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'inactive'::text])))
);


--
-- Name: alembic_version; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: app_settings; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.app_settings (
    key character varying(50) NOT NULL,
    value jsonb NOT NULL
);


--
-- Name: approval_steps; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.approval_steps (
    id integer NOT NULL,
    claim_id integer NOT NULL,
    line_id integer,
    round integer NOT NULL,
    level character varying(10) NOT NULL,
    approver_id integer,
    status character varying(20) NOT NULL,
    amount numeric(12,2),
    approved_amount numeric(12,2),
    acted_by_id integer,
    on_behalf_of_id integer,
    acted_at timestamp with time zone,
    comment text,
    self_approved boolean NOT NULL,
    activated_at timestamp with time zone DEFAULT now() NOT NULL,
    reminded_at timestamp with time zone,
    escalated boolean NOT NULL
);


--
-- Name: approval_steps_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.approval_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: approval_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.approval_steps_id_seq OWNED BY expense.approval_steps.id;


--
-- Name: audit_log; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.audit_log (
    id integer NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id integer,
    on_behalf_of_id integer,
    action character varying(50) NOT NULL,
    entity character varying(50) NOT NULL,
    entity_id character varying(50) NOT NULL,
    claim_id integer,
    level character varying(10),
    amount numeric(12,2),
    self_approved boolean NOT NULL,
    details jsonb NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.audit_log_id_seq OWNED BY expense.audit_log.id;


--
-- Name: categories; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.categories (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    kind character varying(20) NOT NULL,
    gl_code character varying(50) NOT NULL,
    gst_credit_eligible boolean NOT NULL,
    taxable boolean NOT NULL,
    receipt_required boolean NOT NULL,
    extra_field_label character varying(100),
    is_active boolean NOT NULL,
    group_name character varying(100) DEFAULT ''::character varying NOT NULL,
    receipt_threshold numeric(12,2),
    description character varying(200)
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.categories_id_seq OWNED BY expense.categories.id;


--
-- Name: claim_comments; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.claim_comments (
    id integer NOT NULL,
    claim_id integer NOT NULL,
    author_id integer NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: claim_comments_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.claim_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.claim_comments_id_seq OWNED BY expense.claim_comments.id;


--
-- Name: claim_lines; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.claim_lines (
    id integer NOT NULL,
    claim_id integer NOT NULL,
    category_id integer NOT NULL,
    expense_date date NOT NULL,
    merchant character varying(200) NOT NULL,
    description text NOT NULL,
    amount numeric(12,2) NOT NULL,
    approved_amount numeric(12,2),
    status character varying(20) NOT NULL,
    reject_reason text,
    cost_centre character varying(50) NOT NULL,
    state character varying(50) NOT NULL,
    invoice_no character varying(100) NOT NULL,
    supplier_gstin character varying(15) NOT NULL,
    buyer_gstin character varying(15) NOT NULL,
    cgst numeric(12,2) NOT NULL,
    sgst numeric(12,2) NOT NULL,
    igst numeric(12,2) NOT NULL,
    gst_credit_eligible boolean,
    extra_field_value text NOT NULL,
    justification text NOT NULL,
    receipt_path character varying(300),
    receipt_name character varying(300),
    receipt_hash character varying(64),
    policy_flags jsonb NOT NULL,
    duplicate_flags jsonb NOT NULL,
    duplicate_cleared_reason text,
    l1_approver_id integer,
    l2_rules jsonb NOT NULL
);


--
-- Name: claim_lines_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.claim_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.claim_lines_id_seq OWNED BY expense.claim_lines.id;


--
-- Name: claims; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.claims (
    id integer NOT NULL,
    claim_no character varying(20),
    type character varying(20) NOT NULL,
    employee_id integer NOT NULL,
    title character varying(200) NOT NULL,
    status character varying(30) NOT NULL,
    round integer NOT NULL,
    submitted_at timestamp with time zone,
    self_approved boolean NOT NULL,
    total_claimed numeric(12,2) NOT NULL,
    total_approved numeric(12,2),
    return_reason text,
    finance_approved_at timestamp with time zone,
    payment_month character varying(7),
    advance_deducted numeric(12,2) NOT NULL,
    payout_amount numeric(12,2),
    payroll_batch_id integer,
    paid_at timestamp with time zone,
    failure_reason text,
    expected_settlement_date date,
    advance_balance numeric(12,2),
    advance_status character varying(30),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    project character varying(100) DEFAULT ''::character varying NOT NULL,
    purpose text DEFAULT ''::text NOT NULL
);


--
-- Name: claims_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claims_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.claims_id_seq OWNED BY expense.claims.id;


--
-- Name: delegations; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.delegations (
    id integer NOT NULL,
    delegator_id integer NOT NULL,
    delegate_id integer NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: delegations_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.delegations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delegations_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.delegations_id_seq OWNED BY expense.delegations.id;


--
-- Name: notifications; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    message text NOT NULL,
    link character varying(200) NOT NULL,
    is_read boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.notifications_id_seq OWNED BY expense.notifications.id;


--
-- Name: payroll_batches; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.payroll_batches (
    id integer NOT NULL,
    month character varying(7) NOT NULL,
    created_by_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_count integer NOT NULL,
    total_amount numeric(14,2) NOT NULL,
    recovery_total numeric(14,2) NOT NULL,
    recoveries jsonb NOT NULL
);


--
-- Name: payroll_batches_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.payroll_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payroll_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.payroll_batches_id_seq OWNED BY expense.payroll_batches.id;


--
-- Name: policy_limits; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.policy_limits (
    id integer NOT NULL,
    category_id integer NOT NULL,
    scope character varying(20) NOT NULL,
    scope_value character varying(100),
    period character varying(10) NOT NULL,
    amount numeric(12,2) NOT NULL,
    action character varying(10) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    is_active boolean NOT NULL
);


--
-- Name: policy_limits_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.policy_limits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: policy_limits_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.policy_limits_id_seq OWNED BY expense.policy_limits.id;


--
-- Name: users; Type: TABLE; Schema: expense; Owner: -
--

CREATE TABLE expense.users (
    id integer NOT NULL,
    email character varying(200) NOT NULL,
    password_hash character varying(200),
    full_name character varying(200) NOT NULL,
    employee_code character varying(50) NOT NULL,
    department character varying(100) NOT NULL,
    location character varying(100) NOT NULL,
    manager_id integer,
    roles character varying(20)[] NOT NULL,
    is_active boolean NOT NULL,
    preset character varying(20) NOT NULL,
    theme_mode character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    phone character varying(30) DEFAULT ''::character varying NOT NULL,
    designation character varying(100) DEFAULT ''::character varying NOT NULL,
    bank_account_holder character varying(200) DEFAULT ''::character varying NOT NULL,
    bank_account_no character varying(30) DEFAULT ''::character varying NOT NULL,
    bank_ifsc character varying(11) DEFAULT ''::character varying NOT NULL,
    bank_upi character varying(100) DEFAULT ''::character varying NOT NULL,
    bank_pending jsonb,
    notify_prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
    token_version integer DEFAULT 0 NOT NULL,
    suite_user_id character varying(40)
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: expense; Owner: -
--

CREATE SEQUENCE expense.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: expense; Owner: -
--

ALTER SEQUENCE expense.users_id_seq OWNED BY expense.users.id;


--
-- Name: alembic_version; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: app_user; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.app_user (
    id character(26) NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    external_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name_override boolean DEFAULT false NOT NULL,
    photo bytea,
    photo_type text,
    photo_source text,
    photo_updated_at timestamp with time zone,
    inbox_seen_at timestamp with time zone,
    invited_at timestamp with time zone,
    invited_by character(26),
    inbox_cleared_before timestamp with time zone,
    suite_user_id text,
    CONSTRAINT app_user_photo_consistent CHECK ((((photo IS NULL) AND (photo_type IS NULL) AND (photo_source IS NULL) AND (photo_updated_at IS NULL)) OR ((photo IS NOT NULL) AND (photo_type IS NOT NULL) AND (photo_source IS NOT NULL) AND (photo_updated_at IS NOT NULL)))),
    CONSTRAINT app_user_photo_size CHECK (((photo IS NULL) OR (octet_length(photo) <= 262144))),
    CONSTRAINT app_user_photo_source_check CHECK ((photo_source = ANY (ARRAY['user'::text, 'synced'::text]))),
    CONSTRAINT app_user_photo_type_check CHECK ((photo_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]))),
    CONSTRAINT app_user_role_check CHECK ((role = ANY (ARRAY['member'::text, 'admin'::text]))),
    CONSTRAINT app_user_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'inactive'::text])))
);


--
-- Name: attachment; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.attachment (
    id character(26) NOT NULL,
    card_id character(26),
    project_id character(26),
    title text NOT NULL,
    url text NOT NULL,
    kind text,
    note text DEFAULT ''::text NOT NULL,
    added_by character(26) NOT NULL,
    added_at timestamp with time zone NOT NULL,
    CONSTRAINT attachment_check CHECK (((card_id IS NULL) <> (project_id IS NULL))),
    CONSTRAINT attachment_kind_check CHECK ((kind = ANY (ARRAY['document'::text, 'design'::text, 'spec'::text, 'other'::text]))),
    CONSTRAINT attachment_note_check CHECK ((char_length(note) <= 1000)),
    CONSTRAINT attachment_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200))),
    CONSTRAINT attachment_url_check CHECK ((((char_length(url) >= 1) AND (char_length(url) <= 2048)) AND (url ~* '^https?://'::text)))
);


--
-- Name: card_number_seq; Type: SEQUENCE; Schema: kanban; Owner: -
--

CREATE SEQUENCE kanban.card_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: card; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card (
    id character(26) NOT NULL,
    number integer DEFAULT nextval('kanban.card_number_seq'::regclass) NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    plane text NOT NULL,
    state text DEFAULT 'backlog'::text NOT NULL,
    owner_id character(26) NOT NULL,
    assignee_id character(26),
    priority smallint,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    eta date,
    effort_hours numeric(7,2),
    closed_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    team_id character(26),
    project_id character(26),
    CONSTRAINT card_description_check CHECK ((char_length(description) <= 20000)),
    CONSTRAINT card_effort_hours_check CHECK ((effort_hours >= (0)::numeric)),
    CONSTRAINT card_plane_check CHECK ((plane = ANY (ARRAY['private'::text, 'org'::text]))),
    CONSTRAINT card_priority_check CHECK (((priority >= 1) AND (priority <= 4))),
    CONSTRAINT card_private_has_no_team CHECK (((plane = 'org'::text) OR ((team_id IS NULL) AND (project_id IS NULL)))),
    CONSTRAINT card_state_check CHECK ((state = ANY (ARRAY['backlog'::text, 'in_prep'::text, 'ready'::text, 'in_development'::text, 'uat'::text, 'delivered'::text, 'cancelled'::text]))),
    CONSTRAINT card_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)))
);


--
-- Name: card_comment; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card_comment (
    id character(26) NOT NULL,
    card_id character(26) NOT NULL,
    author_id character(26) NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    edited_at timestamp with time zone,
    copied_from_card_id character(26),
    parent_id character(26),
    CONSTRAINT card_comment_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 10000)))
);


--
-- Name: card_event; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card_event (
    id character(26) NOT NULL,
    card_id character(26) NOT NULL,
    group_id character(26) NOT NULL,
    field text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    actor_id character(26) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    copied_from_card_id character(26)
);


--
-- Name: card_link; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card_link (
    id character(26) NOT NULL,
    from_card_id character(26) NOT NULL,
    to_card_id character(26) NOT NULL,
    type text NOT NULL,
    created_by character(26) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT card_link_check CHECK ((from_card_id <> to_card_id)),
    CONSTRAINT card_link_type_check CHECK ((type = ANY (ARRAY['relates_to'::text, 'depends_on'::text, 'blocks'::text])))
);


--
-- Name: comment_vote; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.comment_vote (
    comment_id character(26) NOT NULL,
    user_id character(26) NOT NULL,
    value smallint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT comment_vote_value_check CHECK ((value = ANY (ARRAY['-1'::integer, 1])))
);


--
-- Name: inbox_read; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.inbox_read (
    user_id character(26) NOT NULL,
    event_id character(26) NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: login_issue; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.login_issue (
    id character(26) NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by character(26),
    CONSTRAINT login_issue_check CHECK (((resolved_at IS NULL) = (resolved_by IS NULL))),
    CONSTRAINT login_issue_email_check CHECK (((char_length(email) >= 3) AND (char_length(email) <= 254))),
    CONSTRAINT login_issue_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 2000))),
    CONSTRAINT login_issue_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))
);


--
-- Name: mail_stub_message; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.mail_stub_message (
    id character(26) NOT NULL,
    to_email text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: mail_template; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.mail_template (
    kind text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by character(26) NOT NULL,
    CONSTRAINT mail_template_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 10000))),
    CONSTRAINT mail_template_kind_check CHECK ((kind = ANY (ARRAY['invited'::text, 'assigned'::text, 'blocked'::text, 'comment'::text, 'closed'::text, 'time_reminder'::text, 'time_shortfall'::text, 'time_shortfall_lead'::text, 'time_team_report'::text, 'contact_admin'::text]))),
    CONSTRAINT mail_template_subject_check CHECK (((char_length(subject) >= 1) AND (char_length(subject) <= 300)))
);


--
-- Name: notification; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.notification (
    id character(26) NOT NULL,
    channel text NOT NULL,
    target_id character(26) NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    attempts smallint DEFAULT 0 NOT NULL,
    last_error text,
    CONSTRAINT notification_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'teams'::text]))),
    CONSTRAINT notification_kind_check CHECK ((kind = ANY (ARRAY['assigned'::text, 'blocked'::text, 'comment'::text, 'closed'::text, 'invited'::text, 'time_reminder'::text, 'time_shortfall'::text, 'time_shortfall_lead'::text, 'time_team_report'::text, 'contact_admin'::text])))
);


--
-- Name: org_event; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.org_event (
    id character(26) NOT NULL,
    entity_type text NOT NULL,
    entity_id character(26) NOT NULL,
    group_id character(26) NOT NULL,
    field text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    actor_id character(26) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT org_event_entity_type_check CHECK ((entity_type = ANY (ARRAY['team'::text, 'program'::text, 'project'::text, 'tag'::text])))
);


--
-- Name: program; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.program (
    id character(26) NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    target_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT program_description_check CHECK ((char_length(description) <= 5000)),
    CONSTRAINT program_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))
);


--
-- Name: project; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.project (
    id character(26) NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    team_id character(26) NOT NULL,
    program_id character(26),
    target_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    accepting boolean DEFAULT true NOT NULL,
    closed_at timestamp with time zone,
    closed_by character(26),
    CONSTRAINT project_description_check CHECK ((char_length(description) <= 5000)),
    CONSTRAINT project_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)))
);


--
-- Name: schema_migration; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.schema_migration (
    id text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.session (
    id character(64) NOT NULL,
    user_id character(26) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: tag; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.tag (
    id character(26) NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 40)))
);


--
-- Name: team; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.team (
    id character(26) NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    teams_webhook_url_enc bytea,
    CONSTRAINT team_description_check CHECK ((char_length(description) <= 2000)),
    CONSTRAINT team_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))
);


--
-- Name: team_member; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.team_member (
    team_id character(26) NOT NULL,
    user_id character(26) NOT NULL,
    added_at timestamp with time zone NOT NULL,
    added_by character(26) NOT NULL,
    is_lead boolean DEFAULT false NOT NULL
);


--
-- Name: time_day_off; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.time_day_off (
    user_id character(26) NOT NULL,
    date date NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT time_day_off_date_check CHECK (((EXTRACT(isodow FROM date) >= (1)::numeric) AND (EXTRACT(isodow FROM date) <= (5)::numeric))),
    CONSTRAINT time_day_off_kind_check CHECK ((kind = ANY (ARRAY['leave'::text, 'holiday'::text])))
);


--
-- Name: time_entry; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.time_entry (
    id character(26) NOT NULL,
    card_id character(26) NOT NULL,
    user_id character(26) NOT NULL,
    date date NOT NULL,
    hours numeric(6,2) NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT time_entry_hours_check CHECK (((hours > (0)::numeric) AND (hours <= (24)::numeric))),
    CONSTRAINT time_entry_note_check CHECK ((char_length(note) <= 500))
);


--
-- Name: time_mail_run; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.time_mail_run (
    job text NOT NULL,
    week_start date NOT NULL,
    ran_at timestamp with time zone NOT NULL,
    CONSTRAINT time_mail_run_job_check CHECK ((job = ANY (ARRAY['friday_reminder'::text, 'monday_review'::text])))
);


--
-- Name: time_week_note; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.time_week_note (
    user_id character(26) NOT NULL,
    week_start date NOT NULL,
    note text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT time_week_note_note_check CHECK ((char_length(note) <= 2000)),
    CONSTRAINT time_week_note_week_start_check CHECK ((EXTRACT(isodow FROM week_start) = (1)::numeric))
);


--
-- Name: user_preference; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.user_preference (
    user_id character(26) NOT NULL,
    theme text DEFAULT 'system'::text NOT NULL,
    accent text DEFAULT 'linen'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notify_email boolean DEFAULT false NOT NULL,
    primary_team_id character(26),
    primary_project_id character(26),
    org_order text DEFAULT 'team_first'::text NOT NULL,
    inbox_window_days integer DEFAULT 30 NOT NULL,
    CONSTRAINT user_preference_inbox_window_days_check CHECK (((inbox_window_days >= 1) AND (inbox_window_days <= 365))),
    CONSTRAINT user_preference_org_order_check CHECK ((org_order = ANY (ARRAY['team_first'::text, 'project_first'::text]))),
    CONSTRAINT user_preference_theme_check CHECK ((theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text])))
);


--
-- Name: alembic_version; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.audit_log (
    audit_id bigint NOT NULL,
    actor_id bigint,
    is_system_actor boolean NOT NULL,
    action character varying(80) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id character varying(50) NOT NULL,
    prior_value text,
    new_value text,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_audit_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.audit_log_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.audit_log_audit_id_seq OWNED BY lms.audit_log.audit_id;


--
-- Name: blackout_periods; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.blackout_periods (
    blackout_id bigint NOT NULL,
    name character varying(200) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    leave_type_id bigint,
    is_active boolean NOT NULL,
    created_by bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: blackout_periods_blackout_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.blackout_periods_blackout_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: blackout_periods_blackout_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.blackout_periods_blackout_id_seq OWNED BY lms.blackout_periods.blackout_id;


--
-- Name: calendar_feed_subscriptions; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.calendar_feed_subscriptions (
    subscription_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    feed_token_hash character varying(128) NOT NULL,
    scope character varying(20) NOT NULL,
    is_active boolean NOT NULL,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: calendar_feed_subscriptions_subscription_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.calendar_feed_subscriptions_subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: calendar_feed_subscriptions_subscription_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.calendar_feed_subscriptions_subscription_id_seq OWNED BY lms.calendar_feed_subscriptions.subscription_id;


--
-- Name: compensatory_off_credits; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.compensatory_off_credits (
    comp_off_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    work_date date NOT NULL,
    hours_or_days numeric(6,1) NOT NULL,
    ledger_entry_id bigint,
    approved_by bigint NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: compensatory_off_credits_comp_off_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.compensatory_off_credits_comp_off_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compensatory_off_credits_comp_off_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.compensatory_off_credits_comp_off_id_seq OWNED BY lms.compensatory_off_credits.comp_off_id;


--
-- Name: delegations; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.delegations (
    delegation_id bigint NOT NULL,
    nominator_id bigint NOT NULL,
    delegate_id bigint NOT NULL,
    set_by_id bigint NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: delegations_delegation_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.delegations_delegation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delegations_delegation_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.delegations_delegation_id_seq OWNED BY lms.delegations.delegation_id;


--
-- Name: departments; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.departments (
    department_id bigint NOT NULL,
    department_code character varying(30) NOT NULL,
    department_name character varying(100) NOT NULL,
    is_active boolean NOT NULL
);


--
-- Name: departments_department_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.departments_department_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_department_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.departments_department_id_seq OWNED BY lms.departments.department_id;


--
-- Name: employee_final_settlements; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.employee_final_settlements (
    settlement_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    deactivated_at timestamp without time zone NOT NULL,
    settlement_snapshot_json text NOT NULL,
    created_by bigint,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_final_settlements_settlement_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.employee_final_settlements_settlement_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_final_settlements_settlement_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.employee_final_settlements_settlement_id_seq OWNED BY lms.employee_final_settlements.settlement_id;


--
-- Name: grades; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.grades (
    grade_id bigint NOT NULL,
    grade_code character varying(30) NOT NULL,
    grade_name character varying(100) NOT NULL,
    is_active boolean NOT NULL
);


--
-- Name: grades_grade_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.grades_grade_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: grades_grade_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.grades_grade_id_seq OWNED BY lms.grades.grade_id;


--
-- Name: holidays; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.holidays (
    holiday_id bigint NOT NULL,
    holiday_date date NOT NULL,
    holiday_name character varying(200) NOT NULL,
    leave_year_id bigint NOT NULL,
    region_id bigint,
    is_optional boolean NOT NULL,
    created_by bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: holidays_holiday_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.holidays_holiday_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: holidays_holiday_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.holidays_holiday_id_seq OWNED BY lms.holidays.holiday_id;


--
-- Name: leave_accrual_configs; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_accrual_configs (
    accrual_config_id bigint NOT NULL,
    leave_type_id bigint NOT NULL,
    accrual_method character varying(20) NOT NULL,
    posting_day smallint,
    updated_by bigint,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_accrual_configs_accrual_config_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_accrual_configs_accrual_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_accrual_configs_accrual_config_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_accrual_configs_accrual_config_id_seq OWNED BY lms.leave_accrual_configs.accrual_config_id;


--
-- Name: leave_encashment_requests; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_encashment_requests (
    encashment_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    leave_type_id bigint NOT NULL,
    leave_year_id bigint NOT NULL,
    days_encashed numeric(6,1) NOT NULL,
    ledger_entry_id bigint,
    status character varying(20) NOT NULL,
    requested_by bigint NOT NULL,
    requested_at timestamp without time zone DEFAULT now() NOT NULL,
    notes text
);


--
-- Name: leave_encashment_requests_encashment_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_encashment_requests_encashment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_encashment_requests_encashment_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_encashment_requests_encashment_id_seq OWNED BY lms.leave_encashment_requests.encashment_id;


--
-- Name: leave_ledger; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_ledger (
    entry_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    leave_type_id bigint NOT NULL,
    leave_year_id bigint NOT NULL,
    entry_type character varying(40) NOT NULL,
    quantity numeric(8,1) NOT NULL,
    source_reference character varying(100) NOT NULL,
    actor_id bigint,
    is_system_actor boolean NOT NULL,
    reason text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_ledger_entry_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_ledger_entry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_ledger_entry_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_ledger_entry_id_seq OWNED BY lms.leave_ledger.entry_id;


--
-- Name: leave_policies; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_policies (
    policy_id bigint NOT NULL,
    leave_type_id bigint NOT NULL,
    annual_entitlement numeric(6,1) NOT NULL,
    carries_forward boolean NOT NULL,
    carry_forward_cap numeric(6,1),
    updated_by bigint,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_policies_policy_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_policies_policy_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_policies_policy_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_policies_policy_id_seq OWNED BY lms.leave_policies.policy_id;


--
-- Name: leave_request_approvals; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_request_approvals (
    approval_id bigint NOT NULL,
    request_id bigint NOT NULL,
    stage character varying(20) NOT NULL,
    actor_id bigint NOT NULL,
    on_behalf_of_id bigint,
    decision character varying(10) NOT NULL,
    reason text,
    decision_timestamp timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_request_approvals_approval_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_request_approvals_approval_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_request_approvals_approval_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_request_approvals_approval_id_seq OWNED BY lms.leave_request_approvals.approval_id;


--
-- Name: leave_request_attachments; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_request_attachments (
    attachment_id bigint NOT NULL,
    request_id bigint NOT NULL,
    file_name character varying(255) NOT NULL,
    content_type character varying(100) NOT NULL,
    size_bytes bigint NOT NULL,
    storage_path character varying(500) NOT NULL,
    uploaded_by bigint NOT NULL,
    uploaded_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_request_attachments_attachment_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_request_attachments_attachment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_request_attachments_attachment_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_request_attachments_attachment_id_seq OWNED BY lms.leave_request_attachments.attachment_id;


--
-- Name: leave_requests; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_requests (
    request_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    leave_type_id bigint NOT NULL,
    leave_year_id bigint NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_half_day boolean NOT NULL,
    half_day_portion character varying(10),
    reason text NOT NULL,
    state character varying(40) NOT NULL,
    deducted_days numeric(6,1),
    is_advance_leave boolean NOT NULL,
    is_long_leave boolean NOT NULL,
    application_timestamp timestamp without time zone,
    withdrawal_window_end timestamp without time zone,
    prior_leave_type_id bigint,
    current_approver_id bigint,
    sla_started_at timestamp without time zone,
    lock_version integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_requests_request_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_requests_request_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_requests_request_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_requests_request_id_seq OWNED BY lms.leave_requests.request_id;


--
-- Name: leave_types; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_types (
    leave_type_id bigint NOT NULL,
    type_code character varying(30) NOT NULL,
    type_name character varying(100) NOT NULL,
    is_sick_leave boolean NOT NULL,
    is_balance_affecting boolean NOT NULL,
    is_system boolean NOT NULL,
    is_selectable_by_employee boolean NOT NULL,
    permits_half_day boolean NOT NULL,
    permits_attachments boolean NOT NULL,
    gender_eligibility character varying(10) DEFAULT 'ALL'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_types_leave_type_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_types_leave_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_types_leave_type_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_types_leave_type_id_seq OWNED BY lms.leave_types.leave_type_id;


--
-- Name: leave_years; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.leave_years (
    leave_year_id bigint NOT NULL,
    year_code character varying(10) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_current boolean NOT NULL,
    is_closed boolean NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: leave_years_leave_year_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.leave_years_leave_year_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leave_years_leave_year_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.leave_years_leave_year_id_seq OWNED BY lms.leave_years.leave_year_id;


--
-- Name: lop_records; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.lop_records (
    lop_record_id bigint NOT NULL,
    request_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    prior_leave_type_id bigint NOT NULL,
    lop_leave_type_id bigint NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    deducted_days numeric(6,1) NOT NULL,
    converted_at timestamp without time zone NOT NULL,
    converted_by_job_run_id bigint
);


--
-- Name: lop_records_lop_record_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.lop_records_lop_record_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lop_records_lop_record_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.lop_records_lop_record_id_seq OWNED BY lms.lop_records.lop_record_id;


--
-- Name: management_levels; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.management_levels (
    management_level_id bigint NOT NULL,
    level_code character varying(30) NOT NULL,
    level_name character varying(100) NOT NULL,
    level_rank integer NOT NULL,
    is_active boolean NOT NULL
);


--
-- Name: management_levels_management_level_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.management_levels_management_level_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: management_levels_management_level_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.management_levels_management_level_id_seq OWNED BY lms.management_levels.management_level_id;


--
-- Name: manager_reassignment_log; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.manager_reassignment_log (
    reassignment_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    old_manager_id bigint NOT NULL,
    new_manager_id bigint NOT NULL,
    pending_requests_transferred boolean NOT NULL,
    reassigned_by bigint NOT NULL,
    reassigned_at timestamp without time zone DEFAULT now() NOT NULL,
    notes text
);


--
-- Name: manager_reassignment_log_reassignment_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.manager_reassignment_log_reassignment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: manager_reassignment_log_reassignment_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.manager_reassignment_log_reassignment_id_seq OWNED BY lms.manager_reassignment_log.reassignment_id;


--
-- Name: notification_digest_preferences; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.notification_digest_preferences (
    preference_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    digest_enabled boolean NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_digest_preferences_preference_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.notification_digest_preferences_preference_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_digest_preferences_preference_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.notification_digest_preferences_preference_id_seq OWNED BY lms.notification_digest_preferences.preference_id;


--
-- Name: notification_templates; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.notification_templates (
    template_key character varying(100) NOT NULL,
    subject_template character varying(500) NOT NULL,
    body_template text NOT NULL,
    tokens_json text,
    is_active boolean NOT NULL,
    updated_by bigint,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.notifications (
    notification_id bigint NOT NULL,
    recipient_id bigint NOT NULL,
    channel character varying(10) NOT NULL,
    template_key character varying(100) NOT NULL,
    subject character varying(500) NOT NULL,
    body text NOT NULL,
    status character varying(20) NOT NULL,
    read_at timestamp without time zone,
    related_request_id bigint,
    error_message text,
    sent_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications_notification_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.notifications_notification_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_notification_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.notifications_notification_id_seq OWNED BY lms.notifications.notification_id;


--
-- Name: optional_holiday_selections; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.optional_holiday_selections (
    selection_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    holiday_id bigint NOT NULL,
    leave_year_id bigint NOT NULL,
    selected_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: optional_holiday_selections_selection_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.optional_holiday_selections_selection_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: optional_holiday_selections_selection_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.optional_holiday_selections_selection_id_seq OWNED BY lms.optional_holiday_selections.selection_id;


--
-- Name: organization_configs; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.organization_configs (
    config_key character varying(100) NOT NULL,
    config_value text NOT NULL,
    value_type character varying(20) NOT NULL,
    description character varying(500),
    updated_by bigint,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: project_assignments; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.project_assignments (
    assignment_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    project_id bigint NOT NULL,
    project_lead_id bigint NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_by bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: project_assignments_assignment_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.project_assignments_assignment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_assignments_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.project_assignments_assignment_id_seq OWNED BY lms.project_assignments.assignment_id;


--
-- Name: projects; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.projects (
    project_id bigint NOT NULL,
    project_code character varying(50) NOT NULL,
    project_name character varying(200) NOT NULL,
    is_active boolean NOT NULL
);


--
-- Name: projects_project_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.projects_project_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_project_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.projects_project_id_seq OWNED BY lms.projects.project_id;


--
-- Name: regions; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.regions (
    region_id bigint NOT NULL,
    region_code character varying(30) NOT NULL,
    region_name character varying(100) NOT NULL,
    is_active boolean NOT NULL
);


--
-- Name: regions_region_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.regions_region_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: regions_region_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.regions_region_id_seq OWNED BY lms.regions.region_id;


--
-- Name: roles; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.roles (
    role_id smallint NOT NULL,
    role_code character varying(30) NOT NULL,
    role_name character varying(50) NOT NULL,
    description character varying(200)
);


--
-- Name: roles_role_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.roles_role_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_role_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.roles_role_id_seq OWNED BY lms.roles.role_id;


--
-- Name: scheduled_job_runs; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.scheduled_job_runs (
    job_run_id bigint NOT NULL,
    job_type character varying(40) NOT NULL,
    period_key character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    finished_at timestamp without time zone,
    error_message text
);


--
-- Name: scheduled_job_runs_job_run_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.scheduled_job_runs_job_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduled_job_runs_job_run_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.scheduled_job_runs_job_run_id_seq OWNED BY lms.scheduled_job_runs.job_run_id;


--
-- Name: self_approval_permissions; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.self_approval_permissions (
    self_approval_permission_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    granted_by bigint NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    is_active boolean NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: self_approval_permissions_self_approval_permission_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.self_approval_permissions_self_approval_permission_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: self_approval_permissions_self_approval_permission_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.self_approval_permissions_self_approval_permission_id_seq OWNED BY lms.self_approval_permissions.self_approval_permission_id;


--
-- Name: standing_watchers; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.standing_watchers (
    standing_watcher_id bigint NOT NULL,
    watched_employee_id bigint NOT NULL,
    watcher_employee_id bigint NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    added_by_id bigint NOT NULL,
    added_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: standing_watchers_standing_watcher_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.standing_watchers_standing_watcher_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: standing_watchers_standing_watcher_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.standing_watchers_standing_watcher_id_seq OWNED BY lms.standing_watchers.standing_watcher_id;


--
-- Name: team_capacity_limits; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.team_capacity_limits (
    capacity_limit_id bigint NOT NULL,
    manager_employee_id bigint NOT NULL,
    max_concurrent_on_leave integer NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_by bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: team_capacity_limits_capacity_limit_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.team_capacity_limits_capacity_limit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_capacity_limits_capacity_limit_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.team_capacity_limits_capacity_limit_id_seq OWNED BY lms.team_capacity_limits.capacity_limit_id;


--
-- Name: user_roles; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.user_roles (
    employee_id bigint NOT NULL,
    role_id smallint NOT NULL,
    assigned_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.users (
    user_id bigint NOT NULL,
    entra_oid character varying(64),
    email character varying(255) NOT NULL,
    employee_code character varying(50) NOT NULL,
    suite_user_id text,
    first_name character varying(100),
    last_name character varying(100),
    joined_date date NOT NULL,
    department_id bigint,
    grade_id bigint,
    management_level_id bigint,
    region_id bigint,
    gender character varying(10),
    marital_status character varying(20),
    designation character varying(100),
    manager_id bigint,
    phone character varying(30),
    personal_email character varying(255),
    date_of_birth date,
    emergency_contact_name character varying(150),
    emergency_contact_phone character varying(30),
    avatar_path character varying(500),
    is_active boolean NOT NULL,
    deactivated_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.users_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.users_user_id_seq OWNED BY lms.users.user_id;


--
-- Name: watchers; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.watchers (
    watcher_id bigint NOT NULL,
    request_id bigint NOT NULL,
    watcher_employee_id bigint NOT NULL,
    added_by_id bigint NOT NULL,
    added_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: watchers_watcher_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.watchers_watcher_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: watchers_watcher_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.watchers_watcher_id_seq OWNED BY lms.watchers.watcher_id;


--
-- Name: working_pattern_assignments; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.working_pattern_assignments (
    assignment_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    working_pattern_id bigint NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    assigned_by bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: working_pattern_assignments_assignment_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.working_pattern_assignments_assignment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: working_pattern_assignments_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.working_pattern_assignments_assignment_id_seq OWNED BY lms.working_pattern_assignments.assignment_id;


--
-- Name: working_patterns; Type: TABLE; Schema: lms; Owner: -
--

CREATE TABLE lms.working_patterns (
    working_pattern_id bigint NOT NULL,
    pattern_code character varying(30) NOT NULL,
    pattern_name character varying(100) NOT NULL,
    weekend_days character varying(50) NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: working_patterns_working_pattern_id_seq; Type: SEQUENCE; Schema: lms; Owner: -
--

CREATE SEQUENCE lms.working_patterns_working_pattern_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: working_patterns_working_pattern_id_seq; Type: SEQUENCE OWNED BY; Schema: lms; Owner: -
--

ALTER SEQUENCE lms.working_patterns_working_pattern_id_seq OWNED BY lms.working_patterns.working_pattern_id;


--
-- Name: ams_asset_requests id; Type: DEFAULT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_asset_requests ALTER COLUMN id SET DEFAULT nextval('ams.asset_requests_id_seq'::regclass);


--
-- Name: ams_assets id; Type: DEFAULT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_assets ALTER COLUMN id SET DEFAULT nextval('ams.assets_id_seq'::regclass);


--
-- Name: ams_assignments id; Type: DEFAULT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_assignments ALTER COLUMN id SET DEFAULT nextval('ams.assignments_id_seq'::regclass);


--
-- Name: ams_categories id; Type: DEFAULT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_categories ALTER COLUMN id SET DEFAULT nextval('ams.categories_id_seq'::regclass);


--
-- Name: ams_maintenance_records id; Type: DEFAULT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_maintenance_records ALTER COLUMN id SET DEFAULT nextval('ams.maintenance_records_id_seq'::regclass);


--
-- Name: ams_replacement_requests id; Type: DEFAULT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_replacement_requests ALTER COLUMN id SET DEFAULT nextval('ams.replacement_requests_id_seq'::regclass);


--
-- Name: ams_users id; Type: DEFAULT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_users ALTER COLUMN id SET DEFAULT nextval('ams.users_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.audit_log ALTER COLUMN id SET DEFAULT nextval('app.audit_log_id_seq'::regclass);


--
-- Name: mail_outbox id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.mail_outbox ALTER COLUMN id SET DEFAULT nextval('app.mail_outbox_id_seq'::regclass);


--
-- Name: message id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.message ALTER COLUMN id SET DEFAULT nextval('app.message_id_seq'::regclass);


--
-- Name: role_request id; Type: DEFAULT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.role_request ALTER COLUMN id SET DEFAULT nextval('app.role_request_id_seq'::regclass);


--
-- Name: approval_steps id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.approval_steps ALTER COLUMN id SET DEFAULT nextval('expense.approval_steps_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.audit_log ALTER COLUMN id SET DEFAULT nextval('expense.audit_log_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.categories ALTER COLUMN id SET DEFAULT nextval('expense.categories_id_seq'::regclass);


--
-- Name: claim_comments id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_comments ALTER COLUMN id SET DEFAULT nextval('expense.claim_comments_id_seq'::regclass);


--
-- Name: claim_lines id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_lines ALTER COLUMN id SET DEFAULT nextval('expense.claim_lines_id_seq'::regclass);


--
-- Name: claims id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claims ALTER COLUMN id SET DEFAULT nextval('expense.claims_id_seq'::regclass);


--
-- Name: delegations id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.delegations ALTER COLUMN id SET DEFAULT nextval('expense.delegations_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.notifications ALTER COLUMN id SET DEFAULT nextval('expense.notifications_id_seq'::regclass);


--
-- Name: payroll_batches id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.payroll_batches ALTER COLUMN id SET DEFAULT nextval('expense.payroll_batches_id_seq'::regclass);


--
-- Name: policy_limits id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.policy_limits ALTER COLUMN id SET DEFAULT nextval('expense.policy_limits_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.users ALTER COLUMN id SET DEFAULT nextval('expense.users_id_seq'::regclass);


--
-- Name: audit_log audit_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.audit_log ALTER COLUMN audit_id SET DEFAULT nextval('lms.audit_log_audit_id_seq'::regclass);


--
-- Name: blackout_periods blackout_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.blackout_periods ALTER COLUMN blackout_id SET DEFAULT nextval('lms.blackout_periods_blackout_id_seq'::regclass);


--
-- Name: calendar_feed_subscriptions subscription_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.calendar_feed_subscriptions ALTER COLUMN subscription_id SET DEFAULT nextval('lms.calendar_feed_subscriptions_subscription_id_seq'::regclass);


--
-- Name: compensatory_off_credits comp_off_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.compensatory_off_credits ALTER COLUMN comp_off_id SET DEFAULT nextval('lms.compensatory_off_credits_comp_off_id_seq'::regclass);


--
-- Name: delegations delegation_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.delegations ALTER COLUMN delegation_id SET DEFAULT nextval('lms.delegations_delegation_id_seq'::regclass);


--
-- Name: departments department_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.departments ALTER COLUMN department_id SET DEFAULT nextval('lms.departments_department_id_seq'::regclass);


--
-- Name: employee_final_settlements settlement_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.employee_final_settlements ALTER COLUMN settlement_id SET DEFAULT nextval('lms.employee_final_settlements_settlement_id_seq'::regclass);


--
-- Name: grades grade_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.grades ALTER COLUMN grade_id SET DEFAULT nextval('lms.grades_grade_id_seq'::regclass);


--
-- Name: holidays holiday_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.holidays ALTER COLUMN holiday_id SET DEFAULT nextval('lms.holidays_holiday_id_seq'::regclass);


--
-- Name: leave_accrual_configs accrual_config_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_accrual_configs ALTER COLUMN accrual_config_id SET DEFAULT nextval('lms.leave_accrual_configs_accrual_config_id_seq'::regclass);


--
-- Name: leave_encashment_requests encashment_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_encashment_requests ALTER COLUMN encashment_id SET DEFAULT nextval('lms.leave_encashment_requests_encashment_id_seq'::regclass);


--
-- Name: leave_ledger entry_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_ledger ALTER COLUMN entry_id SET DEFAULT nextval('lms.leave_ledger_entry_id_seq'::regclass);


--
-- Name: leave_policies policy_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_policies ALTER COLUMN policy_id SET DEFAULT nextval('lms.leave_policies_policy_id_seq'::regclass);


--
-- Name: leave_request_approvals approval_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_approvals ALTER COLUMN approval_id SET DEFAULT nextval('lms.leave_request_approvals_approval_id_seq'::regclass);


--
-- Name: leave_request_attachments attachment_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_attachments ALTER COLUMN attachment_id SET DEFAULT nextval('lms.leave_request_attachments_attachment_id_seq'::regclass);


--
-- Name: leave_requests request_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_requests ALTER COLUMN request_id SET DEFAULT nextval('lms.leave_requests_request_id_seq'::regclass);


--
-- Name: leave_types leave_type_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_types ALTER COLUMN leave_type_id SET DEFAULT nextval('lms.leave_types_leave_type_id_seq'::regclass);


--
-- Name: leave_years leave_year_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_years ALTER COLUMN leave_year_id SET DEFAULT nextval('lms.leave_years_leave_year_id_seq'::regclass);


--
-- Name: lop_records lop_record_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.lop_records ALTER COLUMN lop_record_id SET DEFAULT nextval('lms.lop_records_lop_record_id_seq'::regclass);


--
-- Name: management_levels management_level_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.management_levels ALTER COLUMN management_level_id SET DEFAULT nextval('lms.management_levels_management_level_id_seq'::regclass);


--
-- Name: manager_reassignment_log reassignment_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.manager_reassignment_log ALTER COLUMN reassignment_id SET DEFAULT nextval('lms.manager_reassignment_log_reassignment_id_seq'::regclass);


--
-- Name: notification_digest_preferences preference_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notification_digest_preferences ALTER COLUMN preference_id SET DEFAULT nextval('lms.notification_digest_preferences_preference_id_seq'::regclass);


--
-- Name: notifications notification_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notifications ALTER COLUMN notification_id SET DEFAULT nextval('lms.notifications_notification_id_seq'::regclass);


--
-- Name: optional_holiday_selections selection_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.optional_holiday_selections ALTER COLUMN selection_id SET DEFAULT nextval('lms.optional_holiday_selections_selection_id_seq'::regclass);


--
-- Name: project_assignments assignment_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.project_assignments ALTER COLUMN assignment_id SET DEFAULT nextval('lms.project_assignments_assignment_id_seq'::regclass);


--
-- Name: projects project_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.projects ALTER COLUMN project_id SET DEFAULT nextval('lms.projects_project_id_seq'::regclass);


--
-- Name: regions region_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.regions ALTER COLUMN region_id SET DEFAULT nextval('lms.regions_region_id_seq'::regclass);


--
-- Name: roles role_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.roles ALTER COLUMN role_id SET DEFAULT nextval('lms.roles_role_id_seq'::regclass);


--
-- Name: scheduled_job_runs job_run_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.scheduled_job_runs ALTER COLUMN job_run_id SET DEFAULT nextval('lms.scheduled_job_runs_job_run_id_seq'::regclass);


--
-- Name: self_approval_permissions self_approval_permission_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.self_approval_permissions ALTER COLUMN self_approval_permission_id SET DEFAULT nextval('lms.self_approval_permissions_self_approval_permission_id_seq'::regclass);


--
-- Name: standing_watchers standing_watcher_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.standing_watchers ALTER COLUMN standing_watcher_id SET DEFAULT nextval('lms.standing_watchers_standing_watcher_id_seq'::regclass);


--
-- Name: team_capacity_limits capacity_limit_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.team_capacity_limits ALTER COLUMN capacity_limit_id SET DEFAULT nextval('lms.team_capacity_limits_capacity_limit_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users ALTER COLUMN user_id SET DEFAULT nextval('lms.users_user_id_seq'::regclass);


--
-- Name: watchers watcher_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.watchers ALTER COLUMN watcher_id SET DEFAULT nextval('lms.watchers_watcher_id_seq'::regclass);


--
-- Name: working_pattern_assignments assignment_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.working_pattern_assignments ALTER COLUMN assignment_id SET DEFAULT nextval('lms.working_pattern_assignments_assignment_id_seq'::regclass);


--
-- Name: working_patterns working_pattern_id; Type: DEFAULT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.working_patterns ALTER COLUMN working_pattern_id SET DEFAULT nextval('lms.working_patterns_working_pattern_id_seq'::regclass);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: ams_asset_requests asset_requests_pkey; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_asset_requests
    ADD CONSTRAINT asset_requests_pkey PRIMARY KEY (id);


--
-- Name: ams_assets assets_pkey; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: ams_assignments assignments_pkey; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);


--
-- Name: ams_categories categories_pkey; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: ams_maintenance_records maintenance_records_pkey; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_maintenance_records
    ADD CONSTRAINT maintenance_records_pkey PRIMARY KEY (id);


--
-- Name: ams_replacement_requests replacement_requests_pkey; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_replacement_requests
    ADD CONSTRAINT replacement_requests_pkey PRIMARY KEY (id);


--
-- Name: ams_users uq_ams_users_suite_user_id; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_users
    ADD CONSTRAINT uq_ams_users_suite_user_id UNIQUE (suite_user_id);


--
-- Name: ams_assets uq_assets_serial_no; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_assets
    ADD CONSTRAINT uq_assets_serial_no UNIQUE (serial_no);


--
-- Name: ams_categories uq_categories_name; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_categories
    ADD CONSTRAINT uq_categories_name UNIQUE (name);


--
-- Name: ams_users users_pkey; Type: CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: app_access app_access_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.app_access
    ADD CONSTRAINT app_access_pkey PRIMARY KEY (user_id, app);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: mail_outbox mail_outbox_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.mail_outbox
    ADD CONSTRAINT mail_outbox_pkey PRIMARY KEY (id);


--
-- Name: message message_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.message
    ADD CONSTRAINT message_pkey PRIMARY KEY (id);


--
-- Name: role_request role_request_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.role_request
    ADD CONSTRAINT role_request_pkey PRIMARY KEY (id);


--
-- Name: schema_version schema_version_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.schema_version
    ADD CONSTRAINT schema_version_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: user_preference user_preference_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_preference
    ADD CONSTRAINT user_preference_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_entra_oid_key; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_entra_oid_key UNIQUE (entra_oid);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: approval_steps approval_steps_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.approval_steps
    ADD CONSTRAINT approval_steps_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: claim_comments claim_comments_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_comments
    ADD CONSTRAINT claim_comments_pkey PRIMARY KEY (id);


--
-- Name: claim_lines claim_lines_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_lines
    ADD CONSTRAINT claim_lines_pkey PRIMARY KEY (id);


--
-- Name: claims claims_claim_no_key; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claims
    ADD CONSTRAINT claims_claim_no_key UNIQUE (claim_no);


--
-- Name: claims claims_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claims
    ADD CONSTRAINT claims_pkey PRIMARY KEY (id);


--
-- Name: delegations delegations_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.delegations
    ADD CONSTRAINT delegations_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payroll_batches payroll_batches_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.payroll_batches
    ADD CONSTRAINT payroll_batches_pkey PRIMARY KEY (id);


--
-- Name: policy_limits policy_limits_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.policy_limits
    ADD CONSTRAINT policy_limits_pkey PRIMARY KEY (id);


--
-- Name: users uq_users_suite_user_id; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.users
    ADD CONSTRAINT uq_users_suite_user_id UNIQUE (suite_user_id);


--
-- Name: users users_employee_code_key; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.users
    ADD CONSTRAINT users_employee_code_key UNIQUE (employee_code);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);


--
-- Name: app_user app_user_suite_user_id_key; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.app_user
    ADD CONSTRAINT app_user_suite_user_id_key UNIQUE (suite_user_id);


--
-- Name: attachment attachment_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.attachment
    ADD CONSTRAINT attachment_pkey PRIMARY KEY (id);


--
-- Name: card_comment card_comment_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_comment
    ADD CONSTRAINT card_comment_pkey PRIMARY KEY (id);


--
-- Name: card_event card_event_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_event
    ADD CONSTRAINT card_event_pkey PRIMARY KEY (id);


--
-- Name: card_link card_link_from_card_id_to_card_id_type_key; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_link
    ADD CONSTRAINT card_link_from_card_id_to_card_id_type_key UNIQUE (from_card_id, to_card_id, type);


--
-- Name: card_link card_link_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_link
    ADD CONSTRAINT card_link_pkey PRIMARY KEY (id);


--
-- Name: card card_number_key; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_number_key UNIQUE (number);


--
-- Name: card card_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_pkey PRIMARY KEY (id);


--
-- Name: comment_vote comment_vote_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.comment_vote
    ADD CONSTRAINT comment_vote_pkey PRIMARY KEY (comment_id, user_id);


--
-- Name: inbox_read inbox_read_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.inbox_read
    ADD CONSTRAINT inbox_read_pkey PRIMARY KEY (user_id, event_id);


--
-- Name: login_issue login_issue_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.login_issue
    ADD CONSTRAINT login_issue_pkey PRIMARY KEY (id);


--
-- Name: mail_stub_message mail_stub_message_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.mail_stub_message
    ADD CONSTRAINT mail_stub_message_pkey PRIMARY KEY (id);


--
-- Name: mail_template mail_template_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.mail_template
    ADD CONSTRAINT mail_template_pkey PRIMARY KEY (kind);


--
-- Name: notification notification_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (id);


--
-- Name: org_event org_event_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.org_event
    ADD CONSTRAINT org_event_pkey PRIMARY KEY (id);


--
-- Name: program program_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.program
    ADD CONSTRAINT program_pkey PRIMARY KEY (id);


--
-- Name: project project_id_team_id_key; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.project
    ADD CONSTRAINT project_id_team_id_key UNIQUE (id, team_id);


--
-- Name: project project_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (id);


--
-- Name: schema_migration schema_migration_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.schema_migration
    ADD CONSTRAINT schema_migration_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: tag tag_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (id);


--
-- Name: team_member team_member_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.team_member
    ADD CONSTRAINT team_member_pkey PRIMARY KEY (team_id, user_id);


--
-- Name: team team_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.team
    ADD CONSTRAINT team_pkey PRIMARY KEY (id);


--
-- Name: time_day_off time_day_off_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.time_day_off
    ADD CONSTRAINT time_day_off_pkey PRIMARY KEY (user_id, date);


--
-- Name: time_entry time_entry_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.time_entry
    ADD CONSTRAINT time_entry_pkey PRIMARY KEY (id);


--
-- Name: time_mail_run time_mail_run_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.time_mail_run
    ADD CONSTRAINT time_mail_run_pkey PRIMARY KEY (job, week_start);


--
-- Name: time_week_note time_week_note_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.time_week_note
    ADD CONSTRAINT time_week_note_pkey PRIMARY KEY (user_id, week_start);


--
-- Name: user_preference user_preference_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.user_preference
    ADD CONSTRAINT user_preference_pkey PRIMARY KEY (user_id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (audit_id);


--
-- Name: blackout_periods blackout_periods_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.blackout_periods
    ADD CONSTRAINT blackout_periods_pkey PRIMARY KEY (blackout_id);


--
-- Name: calendar_feed_subscriptions calendar_feed_subscriptions_feed_token_hash_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.calendar_feed_subscriptions
    ADD CONSTRAINT calendar_feed_subscriptions_feed_token_hash_key UNIQUE (feed_token_hash);


--
-- Name: calendar_feed_subscriptions calendar_feed_subscriptions_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.calendar_feed_subscriptions
    ADD CONSTRAINT calendar_feed_subscriptions_pkey PRIMARY KEY (subscription_id);


--
-- Name: compensatory_off_credits compensatory_off_credits_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.compensatory_off_credits
    ADD CONSTRAINT compensatory_off_credits_pkey PRIMARY KEY (comp_off_id);


--
-- Name: delegations delegations_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.delegations
    ADD CONSTRAINT delegations_pkey PRIMARY KEY (delegation_id);


--
-- Name: departments departments_department_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.departments
    ADD CONSTRAINT departments_department_code_key UNIQUE (department_code);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (department_id);


--
-- Name: employee_final_settlements employee_final_settlements_employee_id_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.employee_final_settlements
    ADD CONSTRAINT employee_final_settlements_employee_id_key UNIQUE (employee_id);


--
-- Name: employee_final_settlements employee_final_settlements_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.employee_final_settlements
    ADD CONSTRAINT employee_final_settlements_pkey PRIMARY KEY (settlement_id);


--
-- Name: grades grades_grade_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.grades
    ADD CONSTRAINT grades_grade_code_key UNIQUE (grade_code);


--
-- Name: grades grades_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.grades
    ADD CONSTRAINT grades_pkey PRIMARY KEY (grade_id);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (holiday_id);


--
-- Name: leave_accrual_configs leave_accrual_configs_leave_type_id_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_accrual_configs
    ADD CONSTRAINT leave_accrual_configs_leave_type_id_key UNIQUE (leave_type_id);


--
-- Name: leave_accrual_configs leave_accrual_configs_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_accrual_configs
    ADD CONSTRAINT leave_accrual_configs_pkey PRIMARY KEY (accrual_config_id);


--
-- Name: leave_encashment_requests leave_encashment_requests_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_encashment_requests
    ADD CONSTRAINT leave_encashment_requests_pkey PRIMARY KEY (encashment_id);


--
-- Name: leave_ledger leave_ledger_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_ledger
    ADD CONSTRAINT leave_ledger_pkey PRIMARY KEY (entry_id);


--
-- Name: leave_policies leave_policies_leave_type_id_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_policies
    ADD CONSTRAINT leave_policies_leave_type_id_key UNIQUE (leave_type_id);


--
-- Name: leave_policies leave_policies_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_policies
    ADD CONSTRAINT leave_policies_pkey PRIMARY KEY (policy_id);


--
-- Name: leave_request_approvals leave_request_approvals_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_approvals
    ADD CONSTRAINT leave_request_approvals_pkey PRIMARY KEY (approval_id);


--
-- Name: leave_request_attachments leave_request_attachments_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_attachments
    ADD CONSTRAINT leave_request_attachments_pkey PRIMARY KEY (attachment_id);


--
-- Name: leave_requests leave_requests_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_requests
    ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (request_id);


--
-- Name: leave_types leave_types_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_types
    ADD CONSTRAINT leave_types_pkey PRIMARY KEY (leave_type_id);


--
-- Name: leave_types leave_types_type_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_types
    ADD CONSTRAINT leave_types_type_code_key UNIQUE (type_code);


--
-- Name: leave_years leave_years_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_years
    ADD CONSTRAINT leave_years_pkey PRIMARY KEY (leave_year_id);


--
-- Name: leave_years leave_years_year_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_years
    ADD CONSTRAINT leave_years_year_code_key UNIQUE (year_code);


--
-- Name: lop_records lop_records_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.lop_records
    ADD CONSTRAINT lop_records_pkey PRIMARY KEY (lop_record_id);


--
-- Name: lop_records lop_records_request_id_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.lop_records
    ADD CONSTRAINT lop_records_request_id_key UNIQUE (request_id);


--
-- Name: management_levels management_levels_level_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.management_levels
    ADD CONSTRAINT management_levels_level_code_key UNIQUE (level_code);


--
-- Name: management_levels management_levels_level_rank_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.management_levels
    ADD CONSTRAINT management_levels_level_rank_key UNIQUE (level_rank);


--
-- Name: management_levels management_levels_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.management_levels
    ADD CONSTRAINT management_levels_pkey PRIMARY KEY (management_level_id);


--
-- Name: manager_reassignment_log manager_reassignment_log_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.manager_reassignment_log
    ADD CONSTRAINT manager_reassignment_log_pkey PRIMARY KEY (reassignment_id);


--
-- Name: notification_digest_preferences notification_digest_preferences_employee_id_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notification_digest_preferences
    ADD CONSTRAINT notification_digest_preferences_employee_id_key UNIQUE (employee_id);


--
-- Name: notification_digest_preferences notification_digest_preferences_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notification_digest_preferences
    ADD CONSTRAINT notification_digest_preferences_pkey PRIMARY KEY (preference_id);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (template_key);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (notification_id);


--
-- Name: optional_holiday_selections optional_holiday_selections_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.optional_holiday_selections
    ADD CONSTRAINT optional_holiday_selections_pkey PRIMARY KEY (selection_id);


--
-- Name: organization_configs organization_configs_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.organization_configs
    ADD CONSTRAINT organization_configs_pkey PRIMARY KEY (config_key);


--
-- Name: project_assignments project_assignments_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.project_assignments
    ADD CONSTRAINT project_assignments_pkey PRIMARY KEY (assignment_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (project_id);


--
-- Name: projects projects_project_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.projects
    ADD CONSTRAINT projects_project_code_key UNIQUE (project_code);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (region_id);


--
-- Name: regions regions_region_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.regions
    ADD CONSTRAINT regions_region_code_key UNIQUE (region_code);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (role_id);


--
-- Name: roles roles_role_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.roles
    ADD CONSTRAINT roles_role_code_key UNIQUE (role_code);


--
-- Name: scheduled_job_runs scheduled_job_runs_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.scheduled_job_runs
    ADD CONSTRAINT scheduled_job_runs_pkey PRIMARY KEY (job_run_id);


--
-- Name: self_approval_permissions self_approval_permissions_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.self_approval_permissions
    ADD CONSTRAINT self_approval_permissions_pkey PRIMARY KEY (self_approval_permission_id);


--
-- Name: standing_watchers standing_watchers_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.standing_watchers
    ADD CONSTRAINT standing_watchers_pkey PRIMARY KEY (standing_watcher_id);


--
-- Name: team_capacity_limits team_capacity_limits_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.team_capacity_limits
    ADD CONSTRAINT team_capacity_limits_pkey PRIMARY KEY (capacity_limit_id);


--
-- Name: scheduled_job_runs uq_job_type_period_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.scheduled_job_runs
    ADD CONSTRAINT uq_job_type_period_key UNIQUE (job_type, period_key);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (employee_id, role_id);


--
-- Name: users users_entra_oid_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users
    ADD CONSTRAINT users_entra_oid_key UNIQUE (entra_oid);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_suite_user_id_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users
    ADD CONSTRAINT users_suite_user_id_key UNIQUE (suite_user_id);


--
-- Name: watchers watchers_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.watchers
    ADD CONSTRAINT watchers_pkey PRIMARY KEY (watcher_id);


--
-- Name: working_pattern_assignments working_pattern_assignments_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.working_pattern_assignments
    ADD CONSTRAINT working_pattern_assignments_pkey PRIMARY KEY (assignment_id);


--
-- Name: working_patterns working_patterns_pattern_code_key; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.working_patterns
    ADD CONSTRAINT working_patterns_pattern_code_key UNIQUE (pattern_code);


--
-- Name: working_patterns working_patterns_pkey; Type: CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.working_patterns
    ADD CONSTRAINT working_patterns_pkey PRIMARY KEY (working_pattern_id);


--
-- Name: ix_asset_requests_requested_by; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_asset_requests_requested_by ON ams.ams_asset_requests USING btree (requested_by);


--
-- Name: ix_asset_requests_serial_no; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_asset_requests_serial_no ON ams.ams_asset_requests USING btree (serial_no);


--
-- Name: ix_asset_requests_status; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_asset_requests_status ON ams.ams_asset_requests USING btree (status);


--
-- Name: ix_assets_asset_tag; Type: INDEX; Schema: ams; Owner: -
--

CREATE UNIQUE INDEX ix_assets_asset_tag ON ams.ams_assets USING btree (asset_tag);


--
-- Name: ix_assets_category_id; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_assets_category_id ON ams.ams_assets USING btree (category_id);


--
-- Name: ix_assets_name; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_assets_name ON ams.ams_assets USING btree (name);


--
-- Name: ix_assets_service_tag; Type: INDEX; Schema: ams; Owner: -
--

CREATE UNIQUE INDEX ix_assets_service_tag ON ams.ams_assets USING btree (service_tag);


--
-- Name: ix_assets_status; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_assets_status ON ams.ams_assets USING btree (status);


--
-- Name: ix_assets_tag; Type: INDEX; Schema: ams; Owner: -
--

CREATE UNIQUE INDEX ix_assets_tag ON ams.ams_assets USING btree (tag);


--
-- Name: ix_assignments_asset_id; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_assignments_asset_id ON ams.ams_assignments USING btree (asset_id);


--
-- Name: ix_assignments_user_id; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_assignments_user_id ON ams.ams_assignments USING btree (user_id);


--
-- Name: ix_maintenance_records_asset_id; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_maintenance_records_asset_id ON ams.ams_maintenance_records USING btree (asset_id);


--
-- Name: ix_replacement_requests_asset_id; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_replacement_requests_asset_id ON ams.ams_replacement_requests USING btree (asset_id);


--
-- Name: ix_replacement_requests_requested_by; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_replacement_requests_requested_by ON ams.ams_replacement_requests USING btree (requested_by);


--
-- Name: ix_replacement_requests_status; Type: INDEX; Schema: ams; Owner: -
--

CREATE INDEX ix_replacement_requests_status ON ams.ams_replacement_requests USING btree (status);


--
-- Name: ix_users_email; Type: INDEX; Schema: ams; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON ams.ams_users USING btree (email);


--
-- Name: uq_ams_assignments_open_asset; Type: INDEX; Schema: ams; Owner: -
--

CREATE UNIQUE INDEX uq_ams_assignments_open_asset ON ams.ams_assignments USING btree (asset_id) WHERE (returned_on IS NULL);


--
-- Name: audit_log_at_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX audit_log_at_idx ON app.audit_log USING btree (at DESC);


--
-- Name: mail_outbox_due_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX mail_outbox_due_idx ON app.mail_outbox USING btree (next_attempt_at) WHERE (status = 'pending'::text);


--
-- Name: message_user_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX message_user_idx ON app.message USING btree (user_id, created_at DESC);


--
-- Name: role_request_one_pending; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX role_request_one_pending ON app.role_request USING btree (app, user_id) WHERE (status = 'pending'::text);


--
-- Name: role_request_status_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX role_request_status_idx ON app.role_request USING btree (status, created_at DESC);


--
-- Name: session_user_idx; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX session_user_idx ON app.session USING btree (user_id);


--
-- Name: users_employee_code_key; Type: INDEX; Schema: app; Owner: -
--

CREATE UNIQUE INDEX users_employee_code_key ON app.users USING btree (lower(employee_code)) WHERE (employee_code IS NOT NULL);


--
-- Name: ix_approval_steps_approver_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_approval_steps_approver_id ON expense.approval_steps USING btree (approver_id);


--
-- Name: ix_approval_steps_claim_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_approval_steps_claim_id ON expense.approval_steps USING btree (claim_id);


--
-- Name: ix_approval_steps_status; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_approval_steps_status ON expense.approval_steps USING btree (status);


--
-- Name: ix_audit_log_actor_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_audit_log_actor_id ON expense.audit_log USING btree (actor_id);


--
-- Name: ix_audit_log_at; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_audit_log_at ON expense.audit_log USING btree (at);


--
-- Name: ix_audit_log_claim_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_audit_log_claim_id ON expense.audit_log USING btree (claim_id);


--
-- Name: ix_claim_comments_claim_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_claim_comments_claim_id ON expense.claim_comments USING btree (claim_id);


--
-- Name: ix_claim_lines_claim_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_claim_lines_claim_id ON expense.claim_lines USING btree (claim_id);


--
-- Name: ix_claim_lines_receipt_hash; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_claim_lines_receipt_hash ON expense.claim_lines USING btree (receipt_hash);


--
-- Name: ix_claims_employee_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_claims_employee_id ON expense.claims USING btree (employee_id);


--
-- Name: ix_claims_status; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_claims_status ON expense.claims USING btree (status);


--
-- Name: ix_delegations_delegate_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_delegations_delegate_id ON expense.delegations USING btree (delegate_id);


--
-- Name: ix_delegations_delegator_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_delegations_delegator_id ON expense.delegations USING btree (delegator_id);


--
-- Name: ix_notifications_user_id; Type: INDEX; Schema: expense; Owner: -
--

CREATE INDEX ix_notifications_user_id ON expense.notifications USING btree (user_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: expense; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON expense.users USING btree (email);


--
-- Name: app_user_email_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX app_user_email_idx ON kanban.app_user USING btree (lower(email));


--
-- Name: app_user_external_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX app_user_external_idx ON kanban.app_user USING btree (external_id) WHERE (external_id IS NOT NULL);


--
-- Name: attachment_card_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX attachment_card_idx ON kanban.attachment USING btree (card_id);


--
-- Name: attachment_project_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX attachment_project_idx ON kanban.attachment USING btree (project_id);


--
-- Name: card_closed_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_closed_idx ON kanban.card USING btree (closed_at) WHERE (closed_at IS NOT NULL);


--
-- Name: card_comment_card_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_comment_card_idx ON kanban.card_comment USING btree (card_id, created_at);


--
-- Name: card_comment_copied_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_comment_copied_idx ON kanban.card_comment USING btree (copied_from_card_id) WHERE (copied_from_card_id IS NOT NULL);


--
-- Name: card_comment_parent_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_comment_parent_idx ON kanban.card_comment USING btree (parent_id);


--
-- Name: card_event_actor_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_event_actor_idx ON kanban.card_event USING btree (actor_id, created_at);


--
-- Name: card_event_card_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_event_card_idx ON kanban.card_event USING btree (card_id, created_at);


--
-- Name: card_event_copied_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_event_copied_idx ON kanban.card_event USING btree (copied_from_card_id) WHERE (copied_from_card_id IS NOT NULL);


--
-- Name: card_event_created_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_event_created_idx ON kanban.card_event USING btree (created_at);


--
-- Name: card_link_from_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_link_from_idx ON kanban.card_link USING btree (from_card_id);


--
-- Name: card_link_to_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_link_to_idx ON kanban.card_link USING btree (to_card_id);


--
-- Name: card_owner_plane_state_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_owner_plane_state_idx ON kanban.card USING btree (owner_id, plane, state);


--
-- Name: card_project_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_project_idx ON kanban.card USING btree (project_id);


--
-- Name: card_team_state_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_team_state_idx ON kanban.card USING btree (team_id, state) WHERE (plane = 'org'::text);


--
-- Name: card_unassigned_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX card_unassigned_idx ON kanban.card USING btree (state) WHERE ((plane = 'org'::text) AND (team_id IS NULL));


--
-- Name: login_issue_created_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX login_issue_created_idx ON kanban.login_issue USING btree (created_at DESC);


--
-- Name: notification_pending_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX notification_pending_idx ON kanban.notification USING btree (created_at) WHERE (sent_at IS NULL);


--
-- Name: org_event_entity_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX org_event_entity_idx ON kanban.org_event USING btree (entity_type, entity_id, created_at);


--
-- Name: program_name_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX program_name_idx ON kanban.program USING btree (lower(name));


--
-- Name: project_open_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX project_open_idx ON kanban.project USING btree (team_id) WHERE (closed_at IS NULL);


--
-- Name: project_program_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX project_program_idx ON kanban.project USING btree (program_id);


--
-- Name: project_team_name_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX project_team_name_idx ON kanban.project USING btree (team_id, lower(name));


--
-- Name: session_user_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX session_user_idx ON kanban.session USING btree (user_id);


--
-- Name: tag_name_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX tag_name_idx ON kanban.tag USING btree (lower(name));


--
-- Name: team_member_user_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX team_member_user_idx ON kanban.team_member USING btree (user_id);


--
-- Name: team_name_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX team_name_idx ON kanban.team USING btree (lower(name));


--
-- Name: time_entry_card_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX time_entry_card_idx ON kanban.time_entry USING btree (card_id, date);


--
-- Name: time_entry_user_date_idx; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX time_entry_user_date_idx ON kanban.time_entry USING btree (user_id, date);


--
-- Name: ux_self_approval_one_active_per_employee; Type: INDEX; Schema: lms; Owner: -
--

CREATE UNIQUE INDEX ux_self_approval_one_active_per_employee ON lms.self_approval_permissions USING btree (employee_id) WHERE is_active;


--
-- Name: ux_users_email_lower; Type: INDEX; Schema: lms; Owner: -
--

CREATE UNIQUE INDEX ux_users_email_lower ON lms.users USING btree (lower((email)::text));


--
-- Name: ux_users_employee_code_lower; Type: INDEX; Schema: lms; Owner: -
--

CREATE UNIQUE INDEX ux_users_employee_code_lower ON lms.users USING btree (lower((employee_code)::text));


--
-- Name: audit_log audit_log_no_change; Type: TRIGGER; Schema: expense; Owner: -
--

CREATE TRIGGER audit_log_no_change BEFORE DELETE OR UPDATE ON expense.audit_log FOR EACH ROW EXECUTE FUNCTION expense.audit_log_read_only();


--
-- Name: card_event card_event_append_only; Type: TRIGGER; Schema: kanban; Owner: -
--

CREATE TRIGGER card_event_append_only BEFORE DELETE OR UPDATE ON kanban.card_event FOR EACH ROW EXECUTE FUNCTION kanban.append_only_violation();


--
-- Name: org_event org_event_append_only; Type: TRIGGER; Schema: kanban; Owner: -
--

CREATE TRIGGER org_event_append_only BEFORE DELETE OR UPDATE ON kanban.org_event FOR EACH ROW EXECUTE FUNCTION kanban.append_only_violation();


--
-- Name: ams_asset_requests asset_requests_category_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_asset_requests
    ADD CONSTRAINT asset_requests_category_id_fkey FOREIGN KEY (category_id) REFERENCES ams.ams_categories(id) ON DELETE RESTRICT;


--
-- Name: ams_asset_requests asset_requests_created_asset_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_asset_requests
    ADD CONSTRAINT asset_requests_created_asset_id_fkey FOREIGN KEY (created_asset_id) REFERENCES ams.ams_assets(id) ON DELETE SET NULL;


--
-- Name: ams_asset_requests asset_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_asset_requests
    ADD CONSTRAINT asset_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES ams.ams_users(id) ON DELETE RESTRICT;


--
-- Name: ams_asset_requests asset_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_asset_requests
    ADD CONSTRAINT asset_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES ams.ams_users(id) ON DELETE RESTRICT;


--
-- Name: ams_assets assets_category_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_assets
    ADD CONSTRAINT assets_category_id_fkey FOREIGN KEY (category_id) REFERENCES ams.ams_categories(id) ON DELETE RESTRICT;


--
-- Name: ams_assignments assignments_asset_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_assignments
    ADD CONSTRAINT assignments_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES ams.ams_assets(id) ON DELETE RESTRICT;


--
-- Name: ams_assignments assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_assignments
    ADD CONSTRAINT assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES ams.ams_users(id) ON DELETE RESTRICT;


--
-- Name: ams_maintenance_records fk_maintenance_records_opened_by_users; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_maintenance_records
    ADD CONSTRAINT fk_maintenance_records_opened_by_users FOREIGN KEY (opened_by) REFERENCES ams.ams_users(id) ON DELETE SET NULL;


--
-- Name: ams_maintenance_records maintenance_records_asset_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_maintenance_records
    ADD CONSTRAINT maintenance_records_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES ams.ams_assets(id) ON DELETE RESTRICT;


--
-- Name: ams_maintenance_records maintenance_records_replacement_request_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_maintenance_records
    ADD CONSTRAINT maintenance_records_replacement_request_id_fkey FOREIGN KEY (replacement_request_id) REFERENCES ams.ams_replacement_requests(id) ON DELETE SET NULL;


--
-- Name: ams_replacement_requests replacement_requests_asset_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_replacement_requests
    ADD CONSTRAINT replacement_requests_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES ams.ams_assets(id) ON DELETE RESTRICT;


--
-- Name: ams_replacement_requests replacement_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_replacement_requests
    ADD CONSTRAINT replacement_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES ams.ams_users(id) ON DELETE RESTRICT;


--
-- Name: ams_replacement_requests replacement_requests_replacement_asset_id_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_replacement_requests
    ADD CONSTRAINT replacement_requests_replacement_asset_id_fkey FOREIGN KEY (replacement_asset_id) REFERENCES ams.ams_assets(id) ON DELETE RESTRICT;


--
-- Name: ams_replacement_requests replacement_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: ams; Owner: -
--

ALTER TABLE ONLY ams.ams_replacement_requests
    ADD CONSTRAINT replacement_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES ams.ams_users(id) ON DELETE RESTRICT;


--
-- Name: app_access app_access_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.app_access
    ADD CONSTRAINT app_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: message message_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.message
    ADD CONSTRAINT message_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: role_request role_request_decided_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.role_request
    ADD CONSTRAINT role_request_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES app.users(id) ON DELETE SET NULL;


--
-- Name: role_request role_request_requested_by_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.role_request
    ADD CONSTRAINT role_request_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES app.users(id) ON DELETE SET NULL;


--
-- Name: role_request role_request_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.role_request
    ADD CONSTRAINT role_request_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: session session_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: user_preference user_preference_user_id_fkey; Type: FK CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.user_preference
    ADD CONSTRAINT user_preference_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE;


--
-- Name: approval_steps approval_steps_acted_by_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.approval_steps
    ADD CONSTRAINT approval_steps_acted_by_id_fkey FOREIGN KEY (acted_by_id) REFERENCES expense.users(id);


--
-- Name: approval_steps approval_steps_approver_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.approval_steps
    ADD CONSTRAINT approval_steps_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES expense.users(id);


--
-- Name: approval_steps approval_steps_claim_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.approval_steps
    ADD CONSTRAINT approval_steps_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES expense.claims(id) ON DELETE CASCADE;


--
-- Name: approval_steps approval_steps_line_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.approval_steps
    ADD CONSTRAINT approval_steps_line_id_fkey FOREIGN KEY (line_id) REFERENCES expense.claim_lines(id) ON DELETE CASCADE;


--
-- Name: approval_steps approval_steps_on_behalf_of_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.approval_steps
    ADD CONSTRAINT approval_steps_on_behalf_of_id_fkey FOREIGN KEY (on_behalf_of_id) REFERENCES expense.users(id);


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES expense.users(id);


--
-- Name: audit_log audit_log_on_behalf_of_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.audit_log
    ADD CONSTRAINT audit_log_on_behalf_of_id_fkey FOREIGN KEY (on_behalf_of_id) REFERENCES expense.users(id);


--
-- Name: claim_comments claim_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_comments
    ADD CONSTRAINT claim_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES expense.users(id);


--
-- Name: claim_comments claim_comments_claim_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_comments
    ADD CONSTRAINT claim_comments_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES expense.claims(id) ON DELETE CASCADE;


--
-- Name: claim_lines claim_lines_category_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_lines
    ADD CONSTRAINT claim_lines_category_id_fkey FOREIGN KEY (category_id) REFERENCES expense.categories(id);


--
-- Name: claim_lines claim_lines_claim_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_lines
    ADD CONSTRAINT claim_lines_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES expense.claims(id) ON DELETE CASCADE;


--
-- Name: claim_lines claim_lines_l1_approver_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claim_lines
    ADD CONSTRAINT claim_lines_l1_approver_id_fkey FOREIGN KEY (l1_approver_id) REFERENCES expense.users(id);


--
-- Name: claims claims_employee_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claims
    ADD CONSTRAINT claims_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES expense.users(id);


--
-- Name: claims claims_payroll_batch_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.claims
    ADD CONSTRAINT claims_payroll_batch_id_fkey FOREIGN KEY (payroll_batch_id) REFERENCES expense.payroll_batches(id);


--
-- Name: delegations delegations_delegate_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.delegations
    ADD CONSTRAINT delegations_delegate_id_fkey FOREIGN KEY (delegate_id) REFERENCES expense.users(id);


--
-- Name: delegations delegations_delegator_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.delegations
    ADD CONSTRAINT delegations_delegator_id_fkey FOREIGN KEY (delegator_id) REFERENCES expense.users(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES expense.users(id);


--
-- Name: payroll_batches payroll_batches_created_by_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.payroll_batches
    ADD CONSTRAINT payroll_batches_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES expense.users(id);


--
-- Name: policy_limits policy_limits_category_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.policy_limits
    ADD CONSTRAINT policy_limits_category_id_fkey FOREIGN KEY (category_id) REFERENCES expense.categories(id);


--
-- Name: users users_manager_id_fkey; Type: FK CONSTRAINT; Schema: expense; Owner: -
--

ALTER TABLE ONLY expense.users
    ADD CONSTRAINT users_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES expense.users(id);


--
-- Name: app_user app_user_invited_by_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.app_user
    ADD CONSTRAINT app_user_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES kanban.app_user(id);


--
-- Name: attachment attachment_added_by_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.attachment
    ADD CONSTRAINT attachment_added_by_fkey FOREIGN KEY (added_by) REFERENCES kanban.app_user(id);


--
-- Name: attachment attachment_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.attachment
    ADD CONSTRAINT attachment_card_id_fkey FOREIGN KEY (card_id) REFERENCES kanban.card(id);


--
-- Name: attachment attachment_project_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.attachment
    ADD CONSTRAINT attachment_project_id_fkey FOREIGN KEY (project_id) REFERENCES kanban.project(id);


--
-- Name: card card_assignee_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES kanban.app_user(id);


--
-- Name: card_comment card_comment_author_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_comment
    ADD CONSTRAINT card_comment_author_id_fkey FOREIGN KEY (author_id) REFERENCES kanban.app_user(id);


--
-- Name: card_comment card_comment_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_comment
    ADD CONSTRAINT card_comment_card_id_fkey FOREIGN KEY (card_id) REFERENCES kanban.card(id);


--
-- Name: card_comment card_comment_copied_from_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_comment
    ADD CONSTRAINT card_comment_copied_from_card_id_fkey FOREIGN KEY (copied_from_card_id) REFERENCES kanban.card(id);


--
-- Name: card_comment card_comment_parent_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_comment
    ADD CONSTRAINT card_comment_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES kanban.card_comment(id);


--
-- Name: card_event card_event_actor_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_event
    ADD CONSTRAINT card_event_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES kanban.app_user(id);


--
-- Name: card_event card_event_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_event
    ADD CONSTRAINT card_event_card_id_fkey FOREIGN KEY (card_id) REFERENCES kanban.card(id);


--
-- Name: card_event card_event_copied_from_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_event
    ADD CONSTRAINT card_event_copied_from_card_id_fkey FOREIGN KEY (copied_from_card_id) REFERENCES kanban.card(id);


--
-- Name: card_link card_link_created_by_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_link
    ADD CONSTRAINT card_link_created_by_fkey FOREIGN KEY (created_by) REFERENCES kanban.app_user(id);


--
-- Name: card_link card_link_from_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_link
    ADD CONSTRAINT card_link_from_card_id_fkey FOREIGN KEY (from_card_id) REFERENCES kanban.card(id);


--
-- Name: card_link card_link_to_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_link
    ADD CONSTRAINT card_link_to_card_id_fkey FOREIGN KEY (to_card_id) REFERENCES kanban.card(id);


--
-- Name: card card_owner_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES kanban.app_user(id);


--
-- Name: card card_project_team_fk; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_project_team_fk FOREIGN KEY (project_id, team_id) REFERENCES kanban.project(id, team_id) ON UPDATE CASCADE;


--
-- Name: card card_team_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_team_id_fkey FOREIGN KEY (team_id) REFERENCES kanban.team(id);


--
-- Name: comment_vote comment_vote_comment_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.comment_vote
    ADD CONSTRAINT comment_vote_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES kanban.card_comment(id) ON DELETE CASCADE;


--
-- Name: comment_vote comment_vote_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.comment_vote
    ADD CONSTRAINT comment_vote_user_id_fkey FOREIGN KEY (user_id) REFERENCES kanban.app_user(id);


--
-- Name: inbox_read inbox_read_event_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.inbox_read
    ADD CONSTRAINT inbox_read_event_id_fkey FOREIGN KEY (event_id) REFERENCES kanban.card_event(id) ON DELETE CASCADE;


--
-- Name: inbox_read inbox_read_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.inbox_read
    ADD CONSTRAINT inbox_read_user_id_fkey FOREIGN KEY (user_id) REFERENCES kanban.app_user(id) ON DELETE CASCADE;


--
-- Name: login_issue login_issue_resolved_by_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.login_issue
    ADD CONSTRAINT login_issue_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES kanban.app_user(id);


--
-- Name: mail_template mail_template_updated_by_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.mail_template
    ADD CONSTRAINT mail_template_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kanban.app_user(id);


--
-- Name: org_event org_event_actor_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.org_event
    ADD CONSTRAINT org_event_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES kanban.app_user(id);


--
-- Name: project project_closed_by_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.project
    ADD CONSTRAINT project_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES kanban.app_user(id);


--
-- Name: project project_program_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.project
    ADD CONSTRAINT project_program_id_fkey FOREIGN KEY (program_id) REFERENCES kanban.program(id);


--
-- Name: project project_team_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.project
    ADD CONSTRAINT project_team_id_fkey FOREIGN KEY (team_id) REFERENCES kanban.team(id);


--
-- Name: session session_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES kanban.app_user(id);


--
-- Name: team_member team_member_added_by_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.team_member
    ADD CONSTRAINT team_member_added_by_fkey FOREIGN KEY (added_by) REFERENCES kanban.app_user(id);


--
-- Name: team_member team_member_team_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.team_member
    ADD CONSTRAINT team_member_team_id_fkey FOREIGN KEY (team_id) REFERENCES kanban.team(id);


--
-- Name: team_member team_member_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.team_member
    ADD CONSTRAINT team_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES kanban.app_user(id);


--
-- Name: time_day_off time_day_off_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.time_day_off
    ADD CONSTRAINT time_day_off_user_id_fkey FOREIGN KEY (user_id) REFERENCES kanban.app_user(id);


--
-- Name: time_entry time_entry_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.time_entry
    ADD CONSTRAINT time_entry_card_id_fkey FOREIGN KEY (card_id) REFERENCES kanban.card(id);


--
-- Name: time_entry time_entry_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.time_entry
    ADD CONSTRAINT time_entry_user_id_fkey FOREIGN KEY (user_id) REFERENCES kanban.app_user(id);


--
-- Name: time_week_note time_week_note_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.time_week_note
    ADD CONSTRAINT time_week_note_user_id_fkey FOREIGN KEY (user_id) REFERENCES kanban.app_user(id);


--
-- Name: user_preference user_preference_primary_project_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.user_preference
    ADD CONSTRAINT user_preference_primary_project_id_fkey FOREIGN KEY (primary_project_id) REFERENCES kanban.project(id) ON DELETE SET NULL;


--
-- Name: user_preference user_preference_primary_team_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.user_preference
    ADD CONSTRAINT user_preference_primary_team_id_fkey FOREIGN KEY (primary_team_id) REFERENCES kanban.team(id) ON DELETE SET NULL;


--
-- Name: user_preference user_preference_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.user_preference
    ADD CONSTRAINT user_preference_user_id_fkey FOREIGN KEY (user_id) REFERENCES kanban.app_user(id);


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES lms.users(user_id);


--
-- Name: blackout_periods blackout_periods_created_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.blackout_periods
    ADD CONSTRAINT blackout_periods_created_by_fkey FOREIGN KEY (created_by) REFERENCES lms.users(user_id);


--
-- Name: blackout_periods blackout_periods_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.blackout_periods
    ADD CONSTRAINT blackout_periods_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: calendar_feed_subscriptions calendar_feed_subscriptions_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.calendar_feed_subscriptions
    ADD CONSTRAINT calendar_feed_subscriptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: compensatory_off_credits compensatory_off_credits_approved_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.compensatory_off_credits
    ADD CONSTRAINT compensatory_off_credits_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES lms.users(user_id);


--
-- Name: compensatory_off_credits compensatory_off_credits_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.compensatory_off_credits
    ADD CONSTRAINT compensatory_off_credits_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: compensatory_off_credits compensatory_off_credits_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.compensatory_off_credits
    ADD CONSTRAINT compensatory_off_credits_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES lms.leave_ledger(entry_id);


--
-- Name: delegations delegations_delegate_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.delegations
    ADD CONSTRAINT delegations_delegate_id_fkey FOREIGN KEY (delegate_id) REFERENCES lms.users(user_id);


--
-- Name: delegations delegations_nominator_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.delegations
    ADD CONSTRAINT delegations_nominator_id_fkey FOREIGN KEY (nominator_id) REFERENCES lms.users(user_id);


--
-- Name: delegations delegations_set_by_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.delegations
    ADD CONSTRAINT delegations_set_by_id_fkey FOREIGN KEY (set_by_id) REFERENCES lms.users(user_id);


--
-- Name: employee_final_settlements employee_final_settlements_created_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.employee_final_settlements
    ADD CONSTRAINT employee_final_settlements_created_by_fkey FOREIGN KEY (created_by) REFERENCES lms.users(user_id);


--
-- Name: employee_final_settlements employee_final_settlements_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.employee_final_settlements
    ADD CONSTRAINT employee_final_settlements_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: holidays holidays_created_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.holidays
    ADD CONSTRAINT holidays_created_by_fkey FOREIGN KEY (created_by) REFERENCES lms.users(user_id);


--
-- Name: holidays holidays_leave_year_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.holidays
    ADD CONSTRAINT holidays_leave_year_id_fkey FOREIGN KEY (leave_year_id) REFERENCES lms.leave_years(leave_year_id);


--
-- Name: holidays holidays_region_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.holidays
    ADD CONSTRAINT holidays_region_id_fkey FOREIGN KEY (region_id) REFERENCES lms.regions(region_id);


--
-- Name: leave_accrual_configs leave_accrual_configs_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_accrual_configs
    ADD CONSTRAINT leave_accrual_configs_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: leave_accrual_configs leave_accrual_configs_updated_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_accrual_configs
    ADD CONSTRAINT leave_accrual_configs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES lms.users(user_id);


--
-- Name: leave_encashment_requests leave_encashment_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_encashment_requests
    ADD CONSTRAINT leave_encashment_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: leave_encashment_requests leave_encashment_requests_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_encashment_requests
    ADD CONSTRAINT leave_encashment_requests_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: leave_encashment_requests leave_encashment_requests_leave_year_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_encashment_requests
    ADD CONSTRAINT leave_encashment_requests_leave_year_id_fkey FOREIGN KEY (leave_year_id) REFERENCES lms.leave_years(leave_year_id);


--
-- Name: leave_encashment_requests leave_encashment_requests_ledger_entry_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_encashment_requests
    ADD CONSTRAINT leave_encashment_requests_ledger_entry_id_fkey FOREIGN KEY (ledger_entry_id) REFERENCES lms.leave_ledger(entry_id);


--
-- Name: leave_encashment_requests leave_encashment_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_encashment_requests
    ADD CONSTRAINT leave_encashment_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES lms.users(user_id);


--
-- Name: leave_ledger leave_ledger_actor_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_ledger
    ADD CONSTRAINT leave_ledger_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES lms.users(user_id);


--
-- Name: leave_ledger leave_ledger_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_ledger
    ADD CONSTRAINT leave_ledger_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: leave_ledger leave_ledger_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_ledger
    ADD CONSTRAINT leave_ledger_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: leave_ledger leave_ledger_leave_year_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_ledger
    ADD CONSTRAINT leave_ledger_leave_year_id_fkey FOREIGN KEY (leave_year_id) REFERENCES lms.leave_years(leave_year_id);


--
-- Name: leave_policies leave_policies_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_policies
    ADD CONSTRAINT leave_policies_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: leave_policies leave_policies_updated_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_policies
    ADD CONSTRAINT leave_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES lms.users(user_id);


--
-- Name: leave_request_approvals leave_request_approvals_actor_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_approvals
    ADD CONSTRAINT leave_request_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES lms.users(user_id);


--
-- Name: leave_request_approvals leave_request_approvals_on_behalf_of_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_approvals
    ADD CONSTRAINT leave_request_approvals_on_behalf_of_id_fkey FOREIGN KEY (on_behalf_of_id) REFERENCES lms.users(user_id);


--
-- Name: leave_request_approvals leave_request_approvals_request_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_approvals
    ADD CONSTRAINT leave_request_approvals_request_id_fkey FOREIGN KEY (request_id) REFERENCES lms.leave_requests(request_id);


--
-- Name: leave_request_attachments leave_request_attachments_request_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_attachments
    ADD CONSTRAINT leave_request_attachments_request_id_fkey FOREIGN KEY (request_id) REFERENCES lms.leave_requests(request_id);


--
-- Name: leave_request_attachments leave_request_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_request_attachments
    ADD CONSTRAINT leave_request_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES lms.users(user_id);


--
-- Name: leave_requests leave_requests_current_approver_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_requests
    ADD CONSTRAINT leave_requests_current_approver_id_fkey FOREIGN KEY (current_approver_id) REFERENCES lms.users(user_id);


--
-- Name: leave_requests leave_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_requests
    ADD CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: leave_requests leave_requests_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_requests
    ADD CONSTRAINT leave_requests_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: leave_requests leave_requests_leave_year_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_requests
    ADD CONSTRAINT leave_requests_leave_year_id_fkey FOREIGN KEY (leave_year_id) REFERENCES lms.leave_years(leave_year_id);


--
-- Name: leave_requests leave_requests_prior_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.leave_requests
    ADD CONSTRAINT leave_requests_prior_leave_type_id_fkey FOREIGN KEY (prior_leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: lop_records lop_records_converted_by_job_run_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.lop_records
    ADD CONSTRAINT lop_records_converted_by_job_run_id_fkey FOREIGN KEY (converted_by_job_run_id) REFERENCES lms.scheduled_job_runs(job_run_id);


--
-- Name: lop_records lop_records_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.lop_records
    ADD CONSTRAINT lop_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: lop_records lop_records_lop_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.lop_records
    ADD CONSTRAINT lop_records_lop_leave_type_id_fkey FOREIGN KEY (lop_leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: lop_records lop_records_prior_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.lop_records
    ADD CONSTRAINT lop_records_prior_leave_type_id_fkey FOREIGN KEY (prior_leave_type_id) REFERENCES lms.leave_types(leave_type_id);


--
-- Name: lop_records lop_records_request_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.lop_records
    ADD CONSTRAINT lop_records_request_id_fkey FOREIGN KEY (request_id) REFERENCES lms.leave_requests(request_id);


--
-- Name: manager_reassignment_log manager_reassignment_log_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.manager_reassignment_log
    ADD CONSTRAINT manager_reassignment_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: manager_reassignment_log manager_reassignment_log_new_manager_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.manager_reassignment_log
    ADD CONSTRAINT manager_reassignment_log_new_manager_id_fkey FOREIGN KEY (new_manager_id) REFERENCES lms.users(user_id);


--
-- Name: manager_reassignment_log manager_reassignment_log_old_manager_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.manager_reassignment_log
    ADD CONSTRAINT manager_reassignment_log_old_manager_id_fkey FOREIGN KEY (old_manager_id) REFERENCES lms.users(user_id);


--
-- Name: manager_reassignment_log manager_reassignment_log_reassigned_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.manager_reassignment_log
    ADD CONSTRAINT manager_reassignment_log_reassigned_by_fkey FOREIGN KEY (reassigned_by) REFERENCES lms.users(user_id);


--
-- Name: notification_digest_preferences notification_digest_preferences_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notification_digest_preferences
    ADD CONSTRAINT notification_digest_preferences_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: notification_templates notification_templates_updated_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notification_templates
    ADD CONSTRAINT notification_templates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES lms.users(user_id);


--
-- Name: notifications notifications_recipient_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notifications
    ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES lms.users(user_id);


--
-- Name: notifications notifications_related_request_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.notifications
    ADD CONSTRAINT notifications_related_request_id_fkey FOREIGN KEY (related_request_id) REFERENCES lms.leave_requests(request_id);


--
-- Name: optional_holiday_selections optional_holiday_selections_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.optional_holiday_selections
    ADD CONSTRAINT optional_holiday_selections_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: optional_holiday_selections optional_holiday_selections_holiday_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.optional_holiday_selections
    ADD CONSTRAINT optional_holiday_selections_holiday_id_fkey FOREIGN KEY (holiday_id) REFERENCES lms.holidays(holiday_id);


--
-- Name: optional_holiday_selections optional_holiday_selections_leave_year_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.optional_holiday_selections
    ADD CONSTRAINT optional_holiday_selections_leave_year_id_fkey FOREIGN KEY (leave_year_id) REFERENCES lms.leave_years(leave_year_id);


--
-- Name: organization_configs organization_configs_updated_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.organization_configs
    ADD CONSTRAINT organization_configs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES lms.users(user_id);


--
-- Name: project_assignments project_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.project_assignments
    ADD CONSTRAINT project_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES lms.users(user_id);


--
-- Name: project_assignments project_assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.project_assignments
    ADD CONSTRAINT project_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: project_assignments project_assignments_project_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.project_assignments
    ADD CONSTRAINT project_assignments_project_id_fkey FOREIGN KEY (project_id) REFERENCES lms.projects(project_id);


--
-- Name: project_assignments project_assignments_project_lead_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.project_assignments
    ADD CONSTRAINT project_assignments_project_lead_id_fkey FOREIGN KEY (project_lead_id) REFERENCES lms.users(user_id);


--
-- Name: self_approval_permissions self_approval_permissions_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.self_approval_permissions
    ADD CONSTRAINT self_approval_permissions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: self_approval_permissions self_approval_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.self_approval_permissions
    ADD CONSTRAINT self_approval_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES lms.users(user_id);


--
-- Name: standing_watchers standing_watchers_added_by_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.standing_watchers
    ADD CONSTRAINT standing_watchers_added_by_id_fkey FOREIGN KEY (added_by_id) REFERENCES lms.users(user_id);


--
-- Name: standing_watchers standing_watchers_watched_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.standing_watchers
    ADD CONSTRAINT standing_watchers_watched_employee_id_fkey FOREIGN KEY (watched_employee_id) REFERENCES lms.users(user_id);


--
-- Name: standing_watchers standing_watchers_watcher_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.standing_watchers
    ADD CONSTRAINT standing_watchers_watcher_employee_id_fkey FOREIGN KEY (watcher_employee_id) REFERENCES lms.users(user_id);


--
-- Name: team_capacity_limits team_capacity_limits_created_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.team_capacity_limits
    ADD CONSTRAINT team_capacity_limits_created_by_fkey FOREIGN KEY (created_by) REFERENCES lms.users(user_id);


--
-- Name: team_capacity_limits team_capacity_limits_manager_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.team_capacity_limits
    ADD CONSTRAINT team_capacity_limits_manager_employee_id_fkey FOREIGN KEY (manager_employee_id) REFERENCES lms.users(user_id);


--
-- Name: user_roles user_roles_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.user_roles
    ADD CONSTRAINT user_roles_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES lms.roles(role_id);


--
-- Name: users users_department_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users
    ADD CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES lms.departments(department_id);


--
-- Name: users users_grade_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users
    ADD CONSTRAINT users_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES lms.grades(grade_id);


--
-- Name: users users_management_level_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users
    ADD CONSTRAINT users_management_level_id_fkey FOREIGN KEY (management_level_id) REFERENCES lms.management_levels(management_level_id);


--
-- Name: users users_manager_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users
    ADD CONSTRAINT users_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES lms.users(user_id);


--
-- Name: users users_region_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.users
    ADD CONSTRAINT users_region_id_fkey FOREIGN KEY (region_id) REFERENCES lms.regions(region_id);


--
-- Name: watchers watchers_added_by_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.watchers
    ADD CONSTRAINT watchers_added_by_id_fkey FOREIGN KEY (added_by_id) REFERENCES lms.users(user_id);


--
-- Name: watchers watchers_request_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.watchers
    ADD CONSTRAINT watchers_request_id_fkey FOREIGN KEY (request_id) REFERENCES lms.leave_requests(request_id);


--
-- Name: watchers watchers_watcher_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.watchers
    ADD CONSTRAINT watchers_watcher_employee_id_fkey FOREIGN KEY (watcher_employee_id) REFERENCES lms.users(user_id);


--
-- Name: working_pattern_assignments working_pattern_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.working_pattern_assignments
    ADD CONSTRAINT working_pattern_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES lms.users(user_id);


--
-- Name: working_pattern_assignments working_pattern_assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.working_pattern_assignments
    ADD CONSTRAINT working_pattern_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id);


--
-- Name: working_pattern_assignments working_pattern_assignments_working_pattern_id_fkey; Type: FK CONSTRAINT; Schema: lms; Owner: -
--

ALTER TABLE ONLY lms.working_pattern_assignments
    ADD CONSTRAINT working_pattern_assignments_working_pattern_id_fkey FOREIGN KEY (working_pattern_id) REFERENCES lms.working_patterns(working_pattern_id);


--
-- Name: SCHEMA ams; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA ams TO app_rw;


--
-- Name: SCHEMA app; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA app TO app_rw;


--
-- Name: SCHEMA expense; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA expense TO app_rw;


--
-- Name: SCHEMA kanban; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA kanban TO app_rw;


--
-- Name: SCHEMA lms; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA lms TO app_rw;


--
-- Name: TABLE alembic_version; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ams.alembic_version TO app_rw;


--
-- Name: TABLE ams_asset_requests; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ams.ams_asset_requests TO app_rw;


--
-- Name: SEQUENCE ams_asset_tag_seq; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE ams.ams_asset_tag_seq TO app_rw;


--
-- Name: TABLE ams_assets; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ams.ams_assets TO app_rw;


--
-- Name: TABLE ams_assignments; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ams.ams_assignments TO app_rw;


--
-- Name: TABLE ams_categories; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ams.ams_categories TO app_rw;


--
-- Name: TABLE ams_maintenance_records; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ams.ams_maintenance_records TO app_rw;


--
-- Name: TABLE ams_replacement_requests; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ams.ams_replacement_requests TO app_rw;


--
-- Name: TABLE ams_users; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ams.ams_users TO app_rw;


--
-- Name: SEQUENCE asset_requests_id_seq; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE ams.asset_requests_id_seq TO app_rw;


--
-- Name: SEQUENCE assets_id_seq; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE ams.assets_id_seq TO app_rw;


--
-- Name: SEQUENCE assignments_id_seq; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE ams.assignments_id_seq TO app_rw;


--
-- Name: SEQUENCE categories_id_seq; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE ams.categories_id_seq TO app_rw;


--
-- Name: SEQUENCE maintenance_records_id_seq; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE ams.maintenance_records_id_seq TO app_rw;


--
-- Name: SEQUENCE replacement_requests_id_seq; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE ams.replacement_requests_id_seq TO app_rw;


--
-- Name: SEQUENCE users_id_seq; Type: ACL; Schema: ams; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE ams.users_id_seq TO app_rw;


--
-- Name: TABLE app_access; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.app_access TO app_rw;


--
-- Name: TABLE audit_log; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.audit_log TO app_rw;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE app.audit_log_id_seq TO app_rw;


--
-- Name: TABLE mail_outbox; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.mail_outbox TO app_rw;


--
-- Name: SEQUENCE mail_outbox_id_seq; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE app.mail_outbox_id_seq TO app_rw;


--
-- Name: TABLE message; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.message TO app_rw;


--
-- Name: SEQUENCE message_id_seq; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE app.message_id_seq TO app_rw;


--
-- Name: TABLE role_request; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.role_request TO app_rw;


--
-- Name: SEQUENCE role_request_id_seq; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE app.role_request_id_seq TO app_rw;


--
-- Name: TABLE schema_version; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.schema_version TO app_rw;


--
-- Name: TABLE session; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.session TO app_rw;


--
-- Name: TABLE user_preference; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.user_preference TO app_rw;


--
-- Name: TABLE users; Type: ACL; Schema: app; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE app.users TO app_rw;


--
-- Name: TABLE alembic_version; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.alembic_version TO app_rw;


--
-- Name: TABLE app_settings; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.app_settings TO app_rw;


--
-- Name: TABLE approval_steps; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.approval_steps TO app_rw;


--
-- Name: SEQUENCE approval_steps_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.approval_steps_id_seq TO app_rw;


--
-- Name: TABLE audit_log; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.audit_log TO app_rw;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.audit_log_id_seq TO app_rw;


--
-- Name: TABLE categories; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.categories TO app_rw;


--
-- Name: SEQUENCE categories_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.categories_id_seq TO app_rw;


--
-- Name: TABLE claim_comments; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.claim_comments TO app_rw;


--
-- Name: SEQUENCE claim_comments_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.claim_comments_id_seq TO app_rw;


--
-- Name: TABLE claim_lines; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.claim_lines TO app_rw;


--
-- Name: SEQUENCE claim_lines_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.claim_lines_id_seq TO app_rw;


--
-- Name: TABLE claims; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.claims TO app_rw;


--
-- Name: SEQUENCE claims_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.claims_id_seq TO app_rw;


--
-- Name: TABLE delegations; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.delegations TO app_rw;


--
-- Name: SEQUENCE delegations_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.delegations_id_seq TO app_rw;


--
-- Name: TABLE notifications; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.notifications TO app_rw;


--
-- Name: SEQUENCE notifications_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.notifications_id_seq TO app_rw;


--
-- Name: TABLE payroll_batches; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.payroll_batches TO app_rw;


--
-- Name: SEQUENCE payroll_batches_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.payroll_batches_id_seq TO app_rw;


--
-- Name: TABLE policy_limits; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.policy_limits TO app_rw;


--
-- Name: SEQUENCE policy_limits_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.policy_limits_id_seq TO app_rw;


--
-- Name: TABLE users; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE expense.users TO app_rw;


--
-- Name: SEQUENCE users_id_seq; Type: ACL; Schema: expense; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE expense.users_id_seq TO app_rw;


--
-- Name: TABLE app_user; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.app_user TO app_rw;


--
-- Name: TABLE attachment; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE kanban.attachment TO app_rw;


--
-- Name: SEQUENCE card_number_seq; Type: ACL; Schema: kanban; Owner: -
--

GRANT USAGE ON SEQUENCE kanban.card_number_seq TO app_rw;


--
-- Name: TABLE card; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE kanban.card TO app_rw;


--
-- Name: TABLE card_comment; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.card_comment TO app_rw;


--
-- Name: TABLE card_event; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT ON TABLE kanban.card_event TO app_rw;


--
-- Name: TABLE card_link; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE kanban.card_link TO app_rw;


--
-- Name: TABLE comment_vote; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.comment_vote TO app_rw;


--
-- Name: TABLE inbox_read; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE kanban.inbox_read TO app_rw;


--
-- Name: TABLE login_issue; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE kanban.login_issue TO app_rw;


--
-- Name: TABLE mail_stub_message; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE kanban.mail_stub_message TO app_rw;


--
-- Name: TABLE mail_template; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.mail_template TO app_rw;


--
-- Name: TABLE notification; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE kanban.notification TO app_rw;


--
-- Name: TABLE org_event; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT ON TABLE kanban.org_event TO app_rw;


--
-- Name: TABLE program; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.program TO app_rw;


--
-- Name: TABLE project; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.project TO app_rw;


--
-- Name: TABLE session; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.session TO app_rw;


--
-- Name: TABLE tag; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.tag TO app_rw;


--
-- Name: TABLE team; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.team TO app_rw;


--
-- Name: TABLE team_member; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.team_member TO app_rw;


--
-- Name: TABLE time_day_off; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.time_day_off TO app_rw;


--
-- Name: TABLE time_entry; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.time_entry TO app_rw;


--
-- Name: TABLE time_mail_run; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT ON TABLE kanban.time_mail_run TO app_rw;


--
-- Name: TABLE time_week_note; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.time_week_note TO app_rw;


--
-- Name: TABLE user_preference; Type: ACL; Schema: kanban; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE kanban.user_preference TO app_rw;


--
-- Name: TABLE alembic_version; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.alembic_version TO app_rw;


--
-- Name: TABLE audit_log; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.audit_log TO app_rw;


--
-- Name: SEQUENCE audit_log_audit_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.audit_log_audit_id_seq TO app_rw;


--
-- Name: TABLE blackout_periods; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.blackout_periods TO app_rw;


--
-- Name: SEQUENCE blackout_periods_blackout_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.blackout_periods_blackout_id_seq TO app_rw;


--
-- Name: TABLE calendar_feed_subscriptions; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.calendar_feed_subscriptions TO app_rw;


--
-- Name: SEQUENCE calendar_feed_subscriptions_subscription_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.calendar_feed_subscriptions_subscription_id_seq TO app_rw;


--
-- Name: TABLE compensatory_off_credits; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.compensatory_off_credits TO app_rw;


--
-- Name: SEQUENCE compensatory_off_credits_comp_off_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.compensatory_off_credits_comp_off_id_seq TO app_rw;


--
-- Name: TABLE delegations; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.delegations TO app_rw;


--
-- Name: SEQUENCE delegations_delegation_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.delegations_delegation_id_seq TO app_rw;


--
-- Name: TABLE departments; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.departments TO app_rw;


--
-- Name: SEQUENCE departments_department_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.departments_department_id_seq TO app_rw;


--
-- Name: TABLE employee_final_settlements; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.employee_final_settlements TO app_rw;


--
-- Name: SEQUENCE employee_final_settlements_settlement_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.employee_final_settlements_settlement_id_seq TO app_rw;


--
-- Name: TABLE grades; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.grades TO app_rw;


--
-- Name: SEQUENCE grades_grade_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.grades_grade_id_seq TO app_rw;


--
-- Name: TABLE holidays; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.holidays TO app_rw;


--
-- Name: SEQUENCE holidays_holiday_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.holidays_holiday_id_seq TO app_rw;


--
-- Name: TABLE leave_accrual_configs; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_accrual_configs TO app_rw;


--
-- Name: SEQUENCE leave_accrual_configs_accrual_config_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_accrual_configs_accrual_config_id_seq TO app_rw;


--
-- Name: TABLE leave_encashment_requests; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_encashment_requests TO app_rw;


--
-- Name: SEQUENCE leave_encashment_requests_encashment_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_encashment_requests_encashment_id_seq TO app_rw;


--
-- Name: TABLE leave_ledger; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_ledger TO app_rw;


--
-- Name: SEQUENCE leave_ledger_entry_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_ledger_entry_id_seq TO app_rw;


--
-- Name: TABLE leave_policies; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_policies TO app_rw;


--
-- Name: SEQUENCE leave_policies_policy_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_policies_policy_id_seq TO app_rw;


--
-- Name: TABLE leave_request_approvals; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_request_approvals TO app_rw;


--
-- Name: SEQUENCE leave_request_approvals_approval_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_request_approvals_approval_id_seq TO app_rw;


--
-- Name: TABLE leave_request_attachments; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_request_attachments TO app_rw;


--
-- Name: SEQUENCE leave_request_attachments_attachment_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_request_attachments_attachment_id_seq TO app_rw;


--
-- Name: TABLE leave_requests; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_requests TO app_rw;


--
-- Name: SEQUENCE leave_requests_request_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_requests_request_id_seq TO app_rw;


--
-- Name: TABLE leave_types; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_types TO app_rw;


--
-- Name: SEQUENCE leave_types_leave_type_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_types_leave_type_id_seq TO app_rw;


--
-- Name: TABLE leave_years; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.leave_years TO app_rw;


--
-- Name: SEQUENCE leave_years_leave_year_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.leave_years_leave_year_id_seq TO app_rw;


--
-- Name: TABLE lop_records; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.lop_records TO app_rw;


--
-- Name: SEQUENCE lop_records_lop_record_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.lop_records_lop_record_id_seq TO app_rw;


--
-- Name: TABLE management_levels; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.management_levels TO app_rw;


--
-- Name: SEQUENCE management_levels_management_level_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.management_levels_management_level_id_seq TO app_rw;


--
-- Name: TABLE manager_reassignment_log; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.manager_reassignment_log TO app_rw;


--
-- Name: SEQUENCE manager_reassignment_log_reassignment_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.manager_reassignment_log_reassignment_id_seq TO app_rw;


--
-- Name: TABLE notification_digest_preferences; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.notification_digest_preferences TO app_rw;


--
-- Name: SEQUENCE notification_digest_preferences_preference_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.notification_digest_preferences_preference_id_seq TO app_rw;


--
-- Name: TABLE notification_templates; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.notification_templates TO app_rw;


--
-- Name: TABLE notifications; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.notifications TO app_rw;


--
-- Name: SEQUENCE notifications_notification_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.notifications_notification_id_seq TO app_rw;


--
-- Name: TABLE optional_holiday_selections; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.optional_holiday_selections TO app_rw;


--
-- Name: SEQUENCE optional_holiday_selections_selection_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.optional_holiday_selections_selection_id_seq TO app_rw;


--
-- Name: TABLE organization_configs; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.organization_configs TO app_rw;


--
-- Name: TABLE project_assignments; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.project_assignments TO app_rw;


--
-- Name: SEQUENCE project_assignments_assignment_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.project_assignments_assignment_id_seq TO app_rw;


--
-- Name: TABLE projects; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.projects TO app_rw;


--
-- Name: SEQUENCE projects_project_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.projects_project_id_seq TO app_rw;


--
-- Name: TABLE regions; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.regions TO app_rw;


--
-- Name: SEQUENCE regions_region_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.regions_region_id_seq TO app_rw;


--
-- Name: TABLE roles; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.roles TO app_rw;


--
-- Name: SEQUENCE roles_role_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.roles_role_id_seq TO app_rw;


--
-- Name: TABLE scheduled_job_runs; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.scheduled_job_runs TO app_rw;


--
-- Name: SEQUENCE scheduled_job_runs_job_run_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.scheduled_job_runs_job_run_id_seq TO app_rw;


--
-- Name: TABLE self_approval_permissions; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.self_approval_permissions TO app_rw;


--
-- Name: SEQUENCE self_approval_permissions_self_approval_permission_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.self_approval_permissions_self_approval_permission_id_seq TO app_rw;


--
-- Name: TABLE standing_watchers; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.standing_watchers TO app_rw;


--
-- Name: SEQUENCE standing_watchers_standing_watcher_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.standing_watchers_standing_watcher_id_seq TO app_rw;


--
-- Name: TABLE team_capacity_limits; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.team_capacity_limits TO app_rw;


--
-- Name: SEQUENCE team_capacity_limits_capacity_limit_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.team_capacity_limits_capacity_limit_id_seq TO app_rw;


--
-- Name: TABLE user_roles; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.user_roles TO app_rw;


--
-- Name: TABLE users; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.users TO app_rw;


--
-- Name: SEQUENCE users_user_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.users_user_id_seq TO app_rw;


--
-- Name: TABLE watchers; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.watchers TO app_rw;


--
-- Name: SEQUENCE watchers_watcher_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.watchers_watcher_id_seq TO app_rw;


--
-- Name: TABLE working_pattern_assignments; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.working_pattern_assignments TO app_rw;


--
-- Name: SEQUENCE working_pattern_assignments_assignment_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.working_pattern_assignments_assignment_id_seq TO app_rw;


--
-- Name: TABLE working_patterns; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.working_patterns TO app_rw;


--
-- Name: SEQUENCE working_patterns_working_pattern_id_seq; Type: ACL; Schema: lms; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE lms.working_patterns_working_pattern_id_seq TO app_rw;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: ams; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA ams GRANT SELECT,USAGE ON SEQUENCES TO app_rw;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: ams; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA ams GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO app_rw;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: expense; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA expense GRANT SELECT,USAGE ON SEQUENCES TO app_rw;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: expense; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA expense GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO app_rw;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: lms; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA lms GRANT SELECT,USAGE ON SEQUENCES TO app_rw;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: lms; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA lms GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO app_rw;


-- PostgreSQL database dump complete
--

-- ---- Part 3: migration versions (each app sees its migrations as already applied) ---------------------
INSERT INTO ams.alembic_version (version_num) VALUES ('0011_tt_suite_sign_in');
INSERT INTO app.schema_version (id, applied_at) VALUES ('0001_suite', '2026-10-27 18:23:42.775047+00');
INSERT INTO app.schema_version (id, applied_at) VALUES ('0002_asset_manager', '2026-10-27 18:23:42.787695+00');
INSERT INTO app.schema_version (id, applied_at) VALUES ('0003_inbox_requests_sessions', '2026-10-27 18:23:42.795885+00');
INSERT INTO app.schema_version (id, applied_at) VALUES ('0004_profile_details', '2026-10-27 18:23:42.812318+00');
INSERT INTO app.schema_version (id, applied_at) VALUES ('0005_profile_owned_fields', '2026-10-27 18:23:42.825766+00');
INSERT INTO app.schema_version (id, applied_at) VALUES ('0006_resume_app', '2026-10-27 18:23:42.84217+00');
INSERT INTO app.schema_version (id, applied_at) VALUES ('0007_employee_code', '2026-10-27 18:23:42.854722+00');
INSERT INTO expense.alembic_version (version_num) VALUES ('7c3d9e1a2b4f');
INSERT INTO kanban.alembic_version (version_num) VALUES ('0021_suite_user');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0001_init', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0002_identity', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0003_cards', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0004_org', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0005_tags', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0006_profile', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0007_s3a', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0008_s3b', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0009_defaults', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0010_admission', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0011_leads', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0012_project_close', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0013_inbox', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0014_remove_uat', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0015_time_log', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0016_contact_admin', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0017_priority_optional', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0018_mail_templates', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0019_login_issues', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0020_testing_to_uat', '2026-10-27 18:23:48.360749+00');
INSERT INTO kanban.schema_migration (id, applied_at) VALUES ('0021_suite_user', '2026-10-27 18:23:48.360749+00');
-- LMS 0002_employee_leave_types: leave types HR marked as not applicable to a person
CREATE TABLE lms.employee_leave_type_exclusions (
    employee_id bigint NOT NULL,
    leave_type_id bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY lms.employee_leave_type_exclusions
    ADD CONSTRAINT employee_leave_type_exclusions_pkey PRIMARY KEY (employee_id, leave_type_id);
ALTER TABLE ONLY lms.employee_leave_type_exclusions
    ADD CONSTRAINT employee_leave_type_exclusions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES lms.users(user_id) ON DELETE CASCADE;
ALTER TABLE ONLY lms.employee_leave_type_exclusions
    ADD CONSTRAINT employee_leave_type_exclusions_leave_type_id_fkey FOREIGN KEY (leave_type_id) REFERENCES lms.leave_types(leave_type_id) ON DELETE CASCADE;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE lms.employee_leave_type_exclusions TO app_rw;
-- LMS 0003_first_manager_log: a first reporting manager (no old one) can be logged
ALTER TABLE lms.manager_reassignment_log ALTER COLUMN old_manager_id DROP NOT NULL;
INSERT INTO lms.alembic_version (version_num) VALUES ('0004_manager_reassigned_names');

RESET ROLE;
COMMIT;

-- ---- Check -------------------------------------------------------------------------------------------
SELECT n.nspname AS schema, count(*) AS tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname IN ('app', 'kanban', 'lms', 'expense', 'ams')
 GROUP BY 1 ORDER BY 1;
