terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.23"
    }
  }
}

variable "table_name" { type = string }
variable "stream_view_type" { type = string }
variable "billing_mode" { type = string }
variable "read_cu" { type = number }
variable "write_cu" { type = number }

resource "aws_dynamodb_table" "this" {
  name      = var.table_name
  hash_key  = "p"
  range_key = "i"

  attribute {
    name = "p"
    type = "S"
  }

  attribute {
    name = "i"
    type = "N"
  }

  stream_enabled   = tobool(var.stream_view_type)
  stream_view_type = var.stream_view_type

  billing_mode   = var.billing_mode
  read_capacity  = var.read_cu
  write_capacity = var.write_cu
}

output "arn" {
  value = aws_dynamodb_table.this.arn
}

output "stream_arn" {
  value = aws_dynamodb_table.this.arn
}