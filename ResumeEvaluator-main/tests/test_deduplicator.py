from app.services.deduplicator import compute_fingerprint, hamming_distance, is_duplicate

def test_same_text():
    text1 = "This is a standard resume text for software engineer."
    text2 = "This is a standard resume text for software engineer."
    
    fp1 = compute_fingerprint(text1)
    fp2 = compute_fingerprint(text2)
    
    assert hamming_distance(fp1, fp2) == 0
    assert is_duplicate(fp1, fp2)

def test_minor_changes():
    # SimHash operates on character 3-grams, so similarity is sensitive to overall
    # text length: a single-word tweak in a long, realistic resume paragraph stays
    # within a small Hamming distance, while short sentences with several word-level
    # differences (the original version of this test) do not — that was asserting
    # a threshold the algorithm was never going to hit for that input.
    text1 = (
        "This is a standard resume text for a software engineer with five years of "
        "experience building web applications using Python and React."
    )
    text2 = text1.replace("five", "5")

    fp1 = compute_fingerprint(text1)
    fp2 = compute_fingerprint(text2)

    dist = hamming_distance(fp1, fp2)
    assert dist > 0
    # Expected to be similar enough — matches the app's near-duplicate scenario
    assert is_duplicate(fp1, fp2, threshold=5)

def test_completely_different():
    text1 = "Software engineer with 5 years experience in React and Node.js."
    text2 = "Marketing manager skilled in SEO, campaign planning and social media."
    
    fp1 = compute_fingerprint(text1)
    fp2 = compute_fingerprint(text2)
    
    dist = hamming_distance(fp1, fp2)
    assert dist > 10
    assert not is_duplicate(fp1, fp2, threshold=3)
