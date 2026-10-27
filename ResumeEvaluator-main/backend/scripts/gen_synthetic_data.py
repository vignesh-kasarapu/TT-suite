"""Sanitized, production-scale synthetic data generator for local QA.

Run inside the backend container:
    docker exec resumeevaluator-backend-1 python /app/scripts/gen_synthetic_data.py

Generates fake (non-real) users, job roles, skills, resumes (real PDF/DOCX
files pushed through the real /upload pipeline), evaluations, comments,
interview feedback, shortlists, outcomes, and share links — entirely
synthetic data, no real candidate PII.
"""
from __future__ import annotations

import json
import os
import random
import sys
import time

import requests

sys.path.insert(0, "/app")

BASE = "http://localhost:8000"
random.seed(42)

FIRST_NAMES = [
    "Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Arjun", "Divya",
    "Karan", "Meera", "Rahul", "Isha", "Sanjay", "Pooja", "Amit", "Neha",
    "Kabir", "Riya", "Aditya", "Tanvi", "Nikhil", "Shreya", "Varun", "Kavya",
    "Dev", "Simran", "Yash", "Aditi", "Manish", "Anjali", "Suresh", "Lakshmi",
    "Rajesh", "Deepa", "Vivek", "Nandini", "Harsh", "Ritika", "Gaurav", "Swati",
]
LAST_NAMES = [
    "Sharma", "Verma", "Patel", "Reddy", "Nair", "Iyer", "Gupta", "Singh",
    "Rao", "Kulkarni", "Mehta", "Joshi", "Chopra", "Malhotra", "Bose", "Menon",
    "Kapoor", "Desai", "Pillai", "Agarwal",
]
DOMAINS = ["example.com", "mailtest.dev", "testmail.io"]

CANONICAL_HEADERS = {
    "SUMMARY": ["Summary", "Professional Summary", "About Me", "Profile", "Sumary"],
    "SKILLS": ["Skills", "Technical Skills", "Core Competencies", "Skilllz", "Skils"],
    "EXPERIENCE": ["Experience", "Work Experience", "Professional Experience", "Where I've Worked", "Expreience"],
    "PROJECTS": ["Projects", "Key Projects", "Personal Projects", "Projcts"],
    "EDUCATION": ["Education", "Academic Background", "Eduction"],
}

SKILL_POOL = [
    "Python", "FastAPI", "Django", "Flask", "PostgreSQL", "MySQL", "MongoDB",
    "Docker", "Kubernetes", "AWS", "GCP", "Azure", "Redis", "React", "Vue",
    "Angular", "TypeScript", "JavaScript", "Tailwind CSS", "Node.js",
    "spaCy", "scikit-learn", "PyTorch", "TensorFlow", "sentence-transformers",
    "Git", "CI/CD", "GraphQL", "REST APIs", "Terraform", "Kafka", "Spark",
    "Go", "Rust", "Java", "Spring Boot", "C++", "Swift", "Kotlin",
]

TITLES = [
    "Software Engineer", "Senior Software Engineer", "Backend Developer",
    "Frontend Developer", "Full Stack Developer", "ML Engineer",
    "Data Scientist", "DevOps Engineer", "QA Engineer", "Product Manager",
    "Engineering Intern", "Staff Engineer",
]

DEGREES = [
    ("Bachelor of Technology in Computer Science", 2020),
    ("Bachelor of Science in Information Technology", 2019),
    ("Master of Science in Computer Science", 2021),
    ("Bachelor of Engineering in Electronics", 2018),
    ("PhD in Machine Learning", 2022),
    ("Associate Degree in Computer Applications", 2017),
]

JOB_ROLE_SPECS = [
    dict(title="Senior Backend Engineer", min_experience=4, weight_projects=45, weight_skills=35, weight_education=20,
         department="Engineering", work_type="remote", employment_type="full_time",
         job_location="Bangalore, India", salary_min=1800, salary_max=2600,
         skills=["Python", "FastAPI", "PostgreSQL", "Docker", "AWS"]),
    dict(title="Frontend Engineer (React)", min_experience=2, weight_projects=50, weight_skills=30, weight_education=20,
         department="Engineering", work_type="hybrid", employment_type="full_time",
         job_location="Pune, India", salary_min=1200, salary_max=1800,
         skills=["React", "TypeScript", "Tailwind CSS", "JavaScript"]),
    dict(title="Machine Learning Engineer", min_experience=3, weight_projects=55, weight_skills=25, weight_education=20,
         department="AI/ML", work_type="remote", employment_type="full_time",
         job_location="Hyderabad, India", salary_min=2000, salary_max=3200,
         skills=["Python", "PyTorch", "scikit-learn", "sentence-transformers"], require_github=True),
    dict(title="DevOps Engineer", min_experience=3, weight_projects=40, weight_skills=40, weight_education=20,
         department="Infrastructure", work_type="onsite", employment_type="full_time",
         job_location="Chennai, India", salary_min=1500, salary_max=2400,
         skills=["Docker", "Kubernetes", "AWS", "Terraform", "CI/CD"]),
    dict(title="QA Automation Engineer", min_experience=1, weight_projects=30, weight_skills=40, weight_education=30,
         department="Quality", work_type="hybrid", employment_type="full_time",
         job_location="Remote", salary_min=800, salary_max=1400,
         skills=["Python", "Git", "REST APIs"]),
    dict(title="Graduate Software Engineer (Entry Level)", min_experience=0, weight_projects=60, weight_skills=20,
         weight_education=20, department="Engineering", work_type="onsite", employment_type="full_time",
         job_location="Noida, India", salary_min=600, salary_max=900,
         skills=["Java", "Python", "Git"], is_entry_level=True, min_graduation_year=2023, max_graduation_year=2026),
    dict(title="Data Scientist", min_experience=2, weight_projects=50, weight_skills=30, weight_education=20,
         department="AI/ML", work_type="remote", employment_type="full_time",
         job_location="Remote", salary_min=1400, salary_max=2200,
         skills=["Python", "scikit-learn", "PostgreSQL"]),
    dict(title="Contract Backend Developer", min_experience=2, weight_projects=45, weight_skills=35, weight_education=20,
         department="Engineering", work_type="remote", employment_type="contract",
         job_location="Remote", salary_min=1000, salary_max=1600,
         skills=["Node.js", "MongoDB", "REST APIs"]),
    dict(title="Engineering Intern", min_experience=0, weight_projects=70, weight_skills=15, weight_education=15,
         department="Engineering", work_type="onsite", employment_type="internship",
         job_location="Bangalore, India", salary_min=200, salary_max=400,
         skills=["Python", "Git"], is_entry_level=True),
    dict(title="Staff ML Platform Engineer", min_experience=6, weight_projects=40, weight_skills=30, weight_education=30,
         department="AI/ML", work_type="hybrid", employment_type="full_time",
         job_location="Bangalore, India", salary_min=3200, salary_max=4800,
         skills=["Python", "Kubernetes", "Kafka", "Spark"], min_degree="master"),
    dict(title="Paused Intake Role — Legacy Systems", min_experience=5, weight_projects=40, weight_skills=30,
         weight_education=30, department="Platform", work_type="onsite", employment_type="full_time",
         job_location="Mumbai, India", salary_min=1600, salary_max=2400,
         skills=["Java", "PostgreSQL"], intake_paused=True),
    dict(title="Product Manager", min_experience=4, weight_projects=30, weight_skills=30, weight_education=40,
         department="Product", work_type="hybrid", employment_type="full_time",
         job_location="Bangalore, India", salary_min=2200, salary_max=3400,
         skills=["REST APIs", "Git"], min_degree="bachelor"),
]

NUM_CANDIDATES = 220
DUPLICATE_RATE = 0.06  # ~6% of resumes are near-duplicates of an earlier one (dedup testing)


def make_email(name: str, idx: int) -> str:
    slug = name.lower().replace(" ", ".")
    return f"{slug}.{idx}@{random.choice(DOMAINS)}"


def make_phone() -> str:
    return f"+91-{random.randint(70000, 99999)}{random.randint(10000, 99999)}"


def random_headers_variant() -> dict:
    """Pick a header spelling per section — exercises segmenter passes 2 & 3."""
    return {canon: random.choice(variants) for canon, variants in CANONICAL_HEADERS.items()}


def build_resume_text(name: str, email: str, phone: str, github: bool, level: str) -> str:
    headers = random_headers_variant()
    n_skills = random.randint(4, 9)
    skills = random.sample(SKILL_POOL, n_skills)
    title = random.choice(TITLES)
    degree, grad_year = random.choice(DEGREES)
    years_exp = {"junior": random.randint(0, 2), "mid": random.randint(2, 5),
                 "senior": random.randint(5, 10), "executive": random.randint(10, 18)}[level]
    start_year = 2026 - years_exp

    github_line = f"GitHub: https://github.com/{name.lower().replace(' ', '')}\n" if github else ""
    linkedin_line = f"LinkedIn: https://linkedin.com/in/{name.lower().replace(' ', '-')}\n"

    projects = []
    for i in range(random.randint(2, 4)):
        pskills = random.sample(skills, min(2, len(skills)))
        projects.append(
            f"- Built a {random.choice(['recommendation engine', 'internal dashboard', 'data pipeline', 'chat service', 'search index'])} "
            f"using {' and '.join(pskills)}, improving {random.choice(['latency', 'throughput', 'accuracy', 'uptime'])} by {random.randint(10, 60)}%."
        )

    experience_lines = []
    for i in range(random.randint(1, 3)):
        yrs = max(1, years_exp // max(1, random.randint(1, 3)))
        experience_lines.append(
            # Plain ASCII hyphen, not an em-dash: this text gets baked into a
            # PDF via PyMuPDF's base14 "helv" font (see render_pdf below),
            # which has no glyph for U+2014 and silently renders it as "?" —
            # that literal "?" then round-trips through the real parser and
            # shows up in candidate_current_title (e.g. "QA Engineer ? Initech").
            f"{random.choice(TITLES)} - {random.choice(['Acme Corp', 'Globex', 'Initech', 'Umbrella Tech', 'Wayne Digital'])} "
            f"({start_year + i} - {start_year + i + yrs})\n"
            f"  Worked with {', '.join(random.sample(skills, min(3, len(skills))))} to deliver production features."
        )

    text = f"""{name}
{email} | {phone}
{linkedin_line}{github_line}

{headers['SUMMARY']}
{title} with {years_exp} years of experience building scalable systems.

{headers['SKILLS']}
{', '.join(skills)}

{headers['EXPERIENCE']}
{chr(10).join(experience_lines)}

{headers['PROJECTS']}
{chr(10).join(projects)}

{headers['EDUCATION']}
{degree}, Graduated {grad_year}
"""
    return text


def write_pdf(text: str, path: str) -> None:
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    rect = fitz.Rect(36, 36, page.rect.width - 36, page.rect.height - 36)
    page.insert_textbox(rect, text, fontsize=10, fontname="helv")
    doc.save(path)
    doc.close()


def write_docx(text: str, path: str) -> None:
    import docx
    d = docx.Document()
    for line in text.split("\n"):
        d.add_paragraph(line)
    d.save(path)


def login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def main() -> None:
    admin_email = os.environ["ADMIN_EMAIL"]
    admin_password = os.environ["ADMIN_PASSWORD"]
    print(f"Logging in as admin {admin_email} ...")
    admin_token = login(admin_email, admin_password)
    ah = {"Authorization": f"Bearer {admin_token}"}

    # ------------------------------------------------------------------
    # 1. Extra users (recruiter / hiring_manager / interviewer)
    # ------------------------------------------------------------------
    from app.auth import hash_password
    from app.database import SessionLocal
    from app.models import User

    # NOTE: avoid RFC 2606 reserved TLDs (.local/.test/.example/.invalid) here —
    # pydantic's EmailStr rejects them at /auth/login ("special-use or reserved
    # name"), so accounts created with such domains can never log in.
    extra_users = [
        ("recruiter1@tektalis-test.com", "recruiter"),
        ("recruiter2@tektalis-test.com", "recruiter"),
        ("hiring.manager1@tektalis-test.com", "hiring_manager"),
        ("interviewer1@tektalis-test.com", "interviewer"),
        ("interviewer2@tektalis-test.com", "interviewer"),
    ]
    known_password = "QaTest!2026"
    db = SessionLocal()
    created_user_ids = {}
    try:
        for email, role in extra_users:
            existing = db.query(User).filter(User.email == email).first()
            if existing:
                existing.hashed_password = hash_password(known_password)
                existing.is_active = True
                db.flush()
                created_user_ids[email] = existing.id
                continue
            r = requests.post(f"{BASE}/admin/users", headers=ah, json={"email": email, "role": role}, timeout=15)
            if r.status_code not in (200, 201):
                print(f"  WARN create user {email}: {r.status_code} {r.text[:200]}")
                continue
            uid = r.json()["id"]
            u = db.query(User).get(uid)
            u.hashed_password = hash_password(known_password)
            db.flush()
            created_user_ids[email] = uid
            print(f"  Created user {email} (role={role}, id={uid})")
        db.commit()
    finally:
        db.close()
    print(f"QA login password for all synthetic non-admin users: {known_password}")

    # A synthetic candidate-portal account, with a Candidate row already linked
    db = SessionLocal()
    try:
        from app.models import Candidate
        portal_email = "candidate.portal.qa@tektalis-test.com"
        u = db.query(User).filter(User.email == portal_email).first()
        if not u:
            u = User(email=portal_email, hashed_password=hash_password(known_password), role="candidate")
            db.add(u)
            db.flush()
            cand = Candidate(name="Portal QA Candidate", email=portal_email, user_id=u.id, source="manual")
            db.add(cand)
        db.commit()
        print(f"  Candidate portal QA login: {portal_email} / {known_password}")
    finally:
        db.close()

    # ------------------------------------------------------------------
    # 2. Skills — union of all job-role skill lists
    # ------------------------------------------------------------------
    skill_name_to_id = {}
    r = requests.get(f"{BASE}/skills?limit=100", headers=ah, timeout=15)
    for s in r.json().get("items", []):
        skill_name_to_id[s["name"]] = s["id"]
    for name in SKILL_POOL:
        if name in skill_name_to_id:
            continue
        r = requests.post(f"{BASE}/skills", headers=ah, json={"name": name, "category": "General"}, timeout=15)
        if r.status_code == 201:
            skill_name_to_id[name] = r.json()["id"]
        elif r.status_code == 409:
            # race/dup — refetch
            rr = requests.get(f"{BASE}/skills?search={name}&limit=5", headers=ah, timeout=15)
            for s in rr.json().get("items", []):
                if s["name"] == name:
                    skill_name_to_id[name] = s["id"]
    print(f"Skills ready: {len(skill_name_to_id)}")

    # ------------------------------------------------------------------
    # 3. Job roles
    # ------------------------------------------------------------------
    role_ids = {}
    r = requests.get(f"{BASE}/job-roles", headers=ah, timeout=15)
    existing_roles = {jr["title"]: jr["id"] for jr in r.json()}

    for spec in JOB_ROLE_SPECS:
        title = spec["title"]
        if title in existing_roles:
            role_ids[title] = existing_roles[title]
            continue
        skills = spec.pop("skills")
        intake_paused = spec.pop("intake_paused", False)
        body = {
            "title": title,
            "min_experience": spec.get("min_experience", 0),
            "weight_projects": spec["weight_projects"],
            "weight_skills": spec["weight_skills"],
            "weight_education": spec["weight_education"],
            "skill_ids": [skill_name_to_id[s] for s in skills if s in skill_name_to_id],
            "department": spec.get("department"),
            "work_type": spec.get("work_type"),
            "employment_type": spec.get("employment_type"),
            "job_location": spec.get("job_location"),
            "salary_min": spec.get("salary_min"),
            "salary_max": spec.get("salary_max"),
            "require_github": spec.get("require_github", False),
            "is_entry_level": spec.get("is_entry_level", False),
            "min_degree": spec.get("min_degree"),
        }
        if spec.get("min_graduation_year"):
            body["min_graduation_year"] = spec["min_graduation_year"]
        if spec.get("max_graduation_year"):
            body["max_graduation_year"] = spec["max_graduation_year"]
        r = requests.post(f"{BASE}/job-roles", headers=ah, json=body, timeout=15)
        if r.status_code != 201:
            print(f"  WARN create role {title}: {r.status_code} {r.text[:300]}")
            continue
        rid = r.json()["id"]
        role_ids[title] = rid
        print(f"  Created role: {title} (id={rid})")
        if intake_paused:
            requests.patch(f"{BASE}/job-roles/{rid}/intake", headers=ah, json={"paused": True}, timeout=15)

    print(f"Job roles ready: {len(role_ids)}")

    # ------------------------------------------------------------------
    # 4. Candidates + resumes via real /upload pipeline
    # ------------------------------------------------------------------
    tmpdir = "/tmp/synthetic_resumes"
    os.makedirs(tmpdir, exist_ok=True)
    uploaded = []
    prior_texts = []

    levels_cycle = ["junior", "mid", "senior", "executive"]

    for i in range(NUM_CANDIDATES):
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        name = f"{first} {last}"
        email = make_email(name, i)
        phone = make_phone()
        level = random.choices(levels_cycle, weights=[35, 35, 22, 8])[0]
        github = random.random() < 0.55

        is_dup = prior_texts and random.random() < DUPLICATE_RATE
        if is_dup:
            base_text = random.choice(prior_texts)
            # minor formatting tweak — still within simhash dup threshold
            text = base_text.replace("\n\n", "\n \n", 1)
            fname_base = f"dup_{i}_{first}{last}"
        else:
            text = build_resume_text(name, email, phone, github, level)
            prior_texts.append(text)
            fname_base = f"{i}_{first}{last}"

        use_pdf = random.random() < 0.7
        ext = "pdf" if use_pdf else "docx"
        path = os.path.join(tmpdir, f"{fname_base}.{ext}")
        try:
            if use_pdf:
                write_pdf(text, path)
            else:
                write_docx(text, path)
        except Exception as exc:
            print(f"  WARN generate file for {name}: {exc}")
            continue

        data = {
            "candidate_name": name,
            "candidate_email": email,
            "consent_given": "true",
            "ocr_fallback": "true",
            "strip_headers": "true",
            "detect_tables": str(random.random() < 0.2).lower(),
        }
        content_type = ("application/pdf" if use_pdf else
                         "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        r = None
        for attempt in range(6):
            with open(path, "rb") as fh:
                files = {"file": (os.path.basename(path), fh, content_type)}
                try:
                    r = requests.post(f"{BASE}/upload", headers=ah, files=files, data=data, timeout=60)
                except Exception as exc:
                    print(f"  WARN upload {name}: {exc}")
                    r = None
                    break
            if r.status_code != 429:
                break
            wait = int(r.headers.get("Retry-After", "20"))
            print(f"  rate-limited on upload #{i} — sleeping {wait}s (attempt {attempt + 1}/6)")
            time.sleep(wait)
        if r is None:
            continue
        if r.status_code != 201:
            print(f"  WARN upload {name}: {r.status_code} {r.text[:200]}")
            continue
        resp = r.json()
        uploaded.append({**resp, "level": level, "github": github})
        if (i + 1) % 20 == 0:
            print(f"  Uploaded {i + 1}/{NUM_CANDIDATES} (last dup_status={resp.get('duplicate_status')})")

    print(f"Upload complete: {len(uploaded)} responses "
          f"({sum(1 for u in uploaded if u.get('duplicate_status') != 'unique')} flagged dup/near-dup)")

    with open("/tmp/synthetic_upload_results.json", "w") as fh:
        json.dump(uploaded, fh)

    # ------------------------------------------------------------------
    # 5. Run evaluation for every role
    # ------------------------------------------------------------------
    for title, rid in role_ids.items():
        r = requests.post(f"{BASE}/evaluate", headers=ah, json={"job_role_id": rid}, timeout=30)
        print(f"  evaluate({title}): {r.status_code} {r.json() if r.ok else r.text[:200]}")

    # Poll until all roles finish (cap wait)
    deadline = time.time() + 600
    while time.time() < deadline:
        pending = 0
        for title, rid in role_ids.items():
            r = requests.get(f"{BASE}/evaluate/status", headers=ah, params={"job_role_id": rid}, timeout=15)
            if r.ok and r.json().get("in_progress"):
                pending += 1
        if pending == 0:
            break
        print(f"  waiting on {pending} in-progress role(s)...")
        time.sleep(10)

    print("Evaluation pass complete.")

    # ------------------------------------------------------------------
    # 6. Realistic downstream activity: shortlist/comments/feedback/outcomes/share
    # ------------------------------------------------------------------
    all_evals = []
    for title, rid in role_ids.items():
        r = requests.get(f"{BASE}/results", headers=ah, params={"job_role_id": rid, "limit": 200}, timeout=30)
        if r.ok:
            all_evals.extend(r.json().get("items", []))
    print(f"Total scored evaluations visible: {len(all_evals)}")

    statuses = ["shortlisted", "review", "rejected"]
    for ev in all_evals:
        eid = ev["evaluation_id"]
        cid = ev["candidate_id"]
        if random.random() < 0.5:
            status = random.choices(statuses, weights=[30, 40, 30])[0]
            requests.post(f"{BASE}/shortlist", headers=ah,
                          json={"evaluation_id": eid, "status": status, "note": f"Auto-QA note for {status}"},
                          timeout=15)
        if random.random() < 0.25:
            requests.post(f"{BASE}/candidates/{cid}/comments", headers=ah,
                          json={"body": random.choice([
                              "Strong project portfolio, worth a screen.",
                              "Skills look thin for this role — needs review.",
                              "Great communication in initial screen.",
                              "Follow up on GitHub activity before proceeding.",
                          ])}, timeout=15)
        if random.random() < 0.15:
            requests.post(f"{BASE}/interview-feedback", headers=ah, json={
                "candidate_id": cid, "evaluation_id": eid,
                "stage": random.choice(["screening", "coding", "interview"]),
                "rating": random.randint(1, 5),
                "technical_score": round(random.uniform(3, 9.5), 1),
                "communication_score": round(random.uniform(3, 9.5), 1),
                "culture_fit_score": round(random.uniform(3, 9.5), 1),
                "recommendation": random.choice(["strong_hire", "hire", "no_hire", "strong_no_hire"]),
                "notes": "Synthetic QA interview note.",
            }, timeout=15)
        if random.random() < 0.08:
            requests.post(f"{BASE}/outcomes", headers=ah,
                          json={"candidate_id": cid, "outcome": random.choice(["hired", "rejected", "withdrew"])},
                          timeout=15)

    # A couple of share links
    for title, rid in list(role_ids.items())[:3]:
        requests.post(f"{BASE}/share", headers=ah, json={
            "job_role_id": rid, "label": f"QA Share — {title}", "recipient_name": "Hiring Panel",
            "expires_in_days": 14,
        }, timeout=15)

    print("Synthetic data generation complete.")


if __name__ == "__main__":
    main()
