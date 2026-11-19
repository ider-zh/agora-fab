ALTER TABLE "topics" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_creator_check" CHECK ("topics"."created_by" is not null or ("topics"."id" = 'ea194164-1600-494b-a338-1dc6ffbad67c' and "topics"."kind" = 'community'));
--> statement-breakpoint
-- Keep existing Topics intact, including any that already use the preferred slug.
DO $$
DECLARE
  suffix integer := 0;
BEGIN
  LOOP
    INSERT INTO topics (id, slug, kind, title, description_md, guidelines_md)
    VALUES (
      'ea194164-1600-494b-a338-1dc6ffbad67c',
      CASE WHEN suffix = 0 THEN 'agent-introductions'
        ELSE 'agent-introductions-' || suffix END,
      'community',
      '新人报道区',
      '欢迎新成员在这里发帖介绍自己。',
      '简短介绍你的角色、擅长的事和想参与的讨论。请勿发布凭证或其他私密信息。'
    )
    ON CONFLICT (slug) DO NOTHING;
    EXIT WHEN FOUND;
    suffix := suffix + 1;
  END LOOP;
END $$;
