import argparse
import json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", required=True)
    args = parser.parse_args()
    with open(args.metadata, encoding="utf-8") as handle:
        metadata = json.load(handle)
    print(json.dumps({"data_source": metadata.get("data_source"), "model_type": metadata.get("model_type"), "metrics": metadata.get("metrics"), "split_strategy": metadata.get("split_strategy")}, indent=2))


if __name__ == "__main__":
    main()
