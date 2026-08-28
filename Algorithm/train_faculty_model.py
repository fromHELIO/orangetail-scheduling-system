import pandas as pd
import numpy as np
import joblib

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, accuracy_score, f1_score

# ==========================================
# 1. LOAD HISTORICAL DATASET
# ==========================================
print("Loading historical schedule data (2018-2026)...")
# Replace with your actual CSV file path
df = pd.read_csv("historical_schedules.csv")

# Define Feature Columns (X) and Target Column (y)
feature_cols = ['subject_code', 'year_level', 'curriculum_ver', 'is_lab']
target_col = 'professor_id'

X = df[feature_cols]
y = df[target_col]

# ==========================================
# 2. TRAIN / TEST SPLIT (FOR THESIS EVALUATION)
# ==========================================
# Split 80% for training and 20% for testing to prove model accuracy in your paper
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.20, random_state=42, stratify=y
)

print(f"Dataset Split: {len(X_train)} training records | {len(X_test)} testing records")

# ==========================================
# 3. BUILD PREPROCESSING & MODEL PIPELINE
# ==========================================
# Categorical features need to be One-Hot Encoded for Machine Learning
categorical_features = ['subject_code', 'curriculum_ver']
numerical_features = ['year_level', 'is_lab']

preprocessor = ColumnTransformer(
    transformers=[
        ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), categorical_features),
        ('num', 'passthrough', numerical_features)
    ]
)

# Create a unified Scikit-Learn Pipeline
model_pipeline = Pipeline(steps=[
    ('preprocessor', preprocessor),
    ('classifier', RandomForestClassifier(n_estimators=100, random_state=42, max_depth=15))
])

# ==========================================
# 4. TRAIN THE MODEL
# ==========================================
print("Training Random Forest Classifier...")
model_pipeline.fit(X_train, y_train)

# ==========================================
# 5. EVALUATE PERFORMANCE (FOR THESIS RESULTS)
# ==========================================
y_pred = model_pipeline.predict(X_test)

accuracy = accuracy_score(y_test, y_pred)
macro_f1 = f1_score(y_test, y_pred, average='macro')

print("\n" + "="*50)
print("MODEL PERFORMANCE EVALUATION METRICS")
print("="*50)
print(f"Accuracy Score: {accuracy * 100:.2f}%")
print(f"Macro F1-Score: {macro_f1:.4f}")
print("\nDetailed Classification Report:\n")
print(classification_report(y_test, y_pred))
print("="*50)

# ==========================================
# 6. EXPORT TRAINED MODEL FILE (.PKL)
# ==========================================
model_filename = "faculty_affinity_model.pkl"
joblib.dump(model_pipeline, model_filename)
print(f"\nModel successfully saved to '{model_filename}'!")