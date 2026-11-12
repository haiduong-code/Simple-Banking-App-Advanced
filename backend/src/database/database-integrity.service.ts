import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseIntegrityService implements OnModuleInit {
  constructor(private readonly db: DataSource) {}
  async onModuleInit() {
    await this.db.query(`
      CREATE OR REPLACE FUNCTION reject_immutable_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'Banking history is immutable' USING ERRCODE = '23514'; END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS ledger_append_only ON ledger_entries;
      CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
      DROP TRIGGER IF EXISTS audit_append_only ON audit_logs;
      CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
      CREATE OR REPLACE FUNCTION protect_transaction_facts() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Transactions cannot be deleted'; END IF;
        IF ROW(NEW.from_account_id, NEW.to_account_id, NEW.amount, NEW.type, NEW.idempotency_key, NEW.original_transaction_id, NEW.description, NEW.created_at, NEW.actor_id)
          IS DISTINCT FROM ROW(OLD.from_account_id, OLD.to_account_id, OLD.amount, OLD.type, OLD.idempotency_key, OLD.original_transaction_id, OLD.description, OLD.created_at, OLD.actor_id)
        THEN RAISE EXCEPTION 'Transaction facts are immutable'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS transaction_facts_immutable ON transactions;
      CREATE TRIGGER transaction_facts_immutable BEFORE UPDATE OR DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION protect_transaction_facts();
    `);
  }
}
