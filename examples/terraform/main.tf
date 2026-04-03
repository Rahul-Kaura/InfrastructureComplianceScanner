# Example: RDS-shaped resources with attributes the compliance rules care about.
# A real pipeline would export these fields into the scanner snapshot JSON.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  type    = string
  default = "production"
}

resource "aws_db_instance" "example" {
  identifier                 = "demo-compliance-db"
  engine                     = "postgres"
  instance_class             = "db.t3.medium"
  allocated_storage          = 20
  username                   = "dbuser"
  password                   = var.db_password
  skip_final_snapshot        = true
  publicly_accessible        = false
  backup_retention_period    = 7
  storage_encrypted          = true
  multi_az                   = true
  auto_minor_version_upgrade = true

  tags = {
    Environment = var.environment
  }
}

variable "db_password" {
  type        = string
  sensitive   = true
  default     = "local-plan-only-change-me"
  description = "Override in real env; default exists so terraform validate runs without extra input."
}

# After apply, an adapter would map:
# backup_retention_period > 0 -> automatedBackups: true
# storage_encrypted -> encryptionAtRest
# publicly_accessible -> publiclyAccessible
# multi_az / read replicas -> replicaCount (simplified)

output "compliance_hints" {
  value = {
    automated_backups   = aws_db_instance.example.backup_retention_period > 0
    encryption_at_rest  = aws_db_instance.example.storage_encrypted
    publicly_accessible = aws_db_instance.example.publicly_accessible
  }
}
