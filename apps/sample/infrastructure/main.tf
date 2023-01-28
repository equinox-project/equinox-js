terraform {
  required_version = ">= 1.0.2"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.23"
    }
  }

  backend "local" {
    path = "./.state/state.tfstate"
  }
}

provider "aws" {
  region     = "local"
  access_key = "local"
  secret_key = "local"

  skip_credentials_validation = true
  skip_region_validation = true
  skip_requesting_account_id = true

  endpoints {
    dynamodb = "http://localhost:8000"
  }
}

module "events_table" {
  source = "../../../packages/dynamo-store-tf"

  billing_mode     = "PAY_PER_REQUEST"
  stream_view_type = null
  read_cu          = null
  write_cu         = null
  table_name       = "sample_events"
}