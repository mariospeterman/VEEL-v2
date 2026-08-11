drop trigger if exists content_items_safety_release_guard on content_items;
drop function if exists private.enforce_content_safety_release();
drop function if exists private.content_safety_release_ready(uuid);
drop function if exists private.content_performer_readiness(uuid);

drop table if exists regulatory_report_workflows;
drop table if exists media_moderation_appeals;
drop table if exists media_moderation_jobs;
drop table if exists provider_media_scan_events;
drop table if exists media_safety_cases;
drop table if exists performer_consents;
drop table if exists performer_subjects;
drop table if exists content_safety_declarations;
