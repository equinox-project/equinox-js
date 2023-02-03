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
  region     = "us-east-2"
  access_key = "local"
  secret_key = "local"

  skip_credentials_validation = true
  skip_region_validation      = true
  skip_requesting_account_id  = true

  endpoints {
    dynamodb = "http://localhost:4566"
    iam      = "http://localhost:4566"
    lambda   = "http://localhost:4566"
  }
}

module "events_table" {
  source = "../../../packages/dynamo-store-tf"

  billing_mode     = "PAY_PER_REQUEST"
  stream_view_type = "NEW_IMAGE"
  read_cu          = null
  write_cu         = null
  table_name       = "sample_events"
}

module "index_table" {
  source = "../../../packages/dynamo-store-tf"

  billing_mode     = "PAY_PER_REQUEST"
  stream_view_type = null
  read_cu          = null
  write_cu         = null
  table_name       = "sample_events_index"
}

resource "aws_iam_role" "iam_for_lambda" {
  name = "iam_for_indexer_lambda"

  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Effect": "Allow",
      "Sid": ""
    }
  ]
}
EOF
}

data "aws_iam_policy_document" "indexer_lambda_policy" {
  version = "2012-10-17"
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [
      "arn:aws:logs:*:*:*"
    ]
    effect = "Allow"
  }

  statement {
    actions = [
      "dynamodb:BatchGetItem",
      "dynamodb:GetItem",
      "dynamodb:GetRecords",
      "dynamodb:Scan",
      "dynamodb:Query",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams",
      "dynamodb:BatchWriteItem"
    ]
    resources = [
      module.events_table.arn, "${module.events_table.arn}/*",
      module.index_table.arn, "${module.index_table.arn}/*"
    ]
    effect = "Allow"
  }
}

resource "aws_iam_policy" "indexer_lambda_policy" {
  name        = "indexer_lambda_policy"
  path        = "/"
  description = "IAM policy for the indexer lambda"
  policy      = data.aws_iam_policy_document.indexer_lambda_policy.json
}
resource "aws_iam_policy_attachment" "indexer_lambda_policy" {
  name       = "attach lambda policy attachment"
  roles      = [aws_iam_role.iam_for_lambda.name]
  policy_arn = aws_iam_policy.indexer_lambda_policy.arn
}

resource "aws_lambda_function" "indexer" {
  function_name    = "sample_events_indexer"
  handler          = "index.handler"
  role             = aws_iam_role.iam_for_lambda.arn
  runtime          = "nodejs16.x"
  filename         = "${path.module}/../../../packages/dynamo-store-indexer-lambda/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../packages/dynamo-store-indexer-lambda/dist/lambda.zip")
  environment {
    variables = {
      "AWS_REGION"       = "us-east-2"
      "LOCAL"            = "true"
      "TABLE_NAME"       = module.events_table.table_name
      "INDEX_TABLE_NAME" = module.index_table.table_name
    }
  }
}

resource "aws_lambda_event_source_mapping" "streams_invoker" {
  event_source_arn  = module.events_table.stream_arn
  function_name     = aws_lambda_function.indexer.arn
  batch_size        = 500
  starting_position = "TRIM_HORIZON"
  enabled           = true
}
