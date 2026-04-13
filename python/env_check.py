import sys
import json
import importlib.util

def check_packages(packages):
    missing = []
    for pkg in packages:
        # Handle cases like 'opencv-python' which is imported as 'cv2'
        import_name = pkg
        if pkg == 'opencv-python': import_name = 'cv2'
        elif pkg == 'scikit-learn': import_name = 'sklearn'
        elif pkg == 'pillow': import_name = 'PIL'
        
        spec = importlib.util.find_spec(import_name)
        if spec is None:
            missing.append(pkg)
    return missing

if __name__ == "__main__":
    try:
        packages_to_check = json.loads(sys.argv[1])
        missing_packages = check_packages(packages_to_check)
        print(json.dumps({"missing": missing_packages}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
