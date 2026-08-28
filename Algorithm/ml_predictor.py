import pandas as pd
import joblib

# Load the saved model pipeline once when the module is imported
MODEL_PATH = "faculty_affinity_model.pkl"

try:
    model_pipeline = joblib.load(MODEL_PATH)
    # Extract the list of known teacher names from the trained classifier
    classes = list(model_pipeline.named_steps['classifier'].classes_)
    print("ML Predictor: Faculty Affinity Model loaded successfully.")
except Exception as e:
    print(f"ML Predictor Error: Could not load '{MODEL_PATH}'. Ensure training script was run first. Details: {e}")
    model_pipeline = None
    classes = []


def get_faculty_compatibility(subjcode, program, year_level, school_year, semester, schedtype, lab_cat, teacher_name):
    # Safety Check: If model failed to load or teacher is not in historical dataset
    if model_pipeline is None or teacher_name not in classes:
        return 0.1  # Return low baseline score

    # Construct a 1-row DataFrame matching the model's training feature columns
    input_data = pd.DataFrame([{
        'SUBJCODE': str(subjcode),
        'PROGRAM': str(program),
        'YEAR_LEVEL': int(year_level),
        'SCHOOL_YEAR': str(school_year),
        'SEMESTER': int(semester),
        'SCHEDTYPE': str(schedtype),
        'LAB_CAT': str(lab_cat)
    }])

    probabilities = model_pipeline.predict_proba(input_data)[0]

    # Look up the specific probability for the requested teacher
    teacher_index = classes.index(teacher_name)
    compatibility_score = float(probabilities[teacher_index])

    return compatibility_score


# ==========================================
# TEST SCRIPT (Runs when executing this file directly)
# ==========================================
if __name__ == "__main__":
    # Sample Test Query matching your dataset structure
    sample_subjcode = "6CFUN"
    sample_program = "BSCS"
    sample_year_level = 1
    sample_school_year = "2023-2024"
    sample_semester = 1
    sample_schedtype = "Regular"
    sample_lab_cat = "3B"
    sample_teacher = "BULANADI, JEHAN D"  # Replace with a real teacher name from your CSV

    score = get_faculty_compatibility(
        subjcode=sample_subjcode,
        program=sample_program,
        year_level=sample_year_level,
        school_year=sample_school_year,
        semester=sample_semester,
        schedtype=sample_schedtype,
        lab_cat=sample_lab_cat,
        teacher_name=sample_teacher
    )

    print("\n--- Test Query Result ---")
    print(f"Subject: {sample_subjcode} | Teacher: {sample_teacher}")
    print(f"Calculated Compatibility Score: {score:.4f} (or {score * 100:.2f}%)")