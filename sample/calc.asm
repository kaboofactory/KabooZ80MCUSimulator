; ============================================================================
; KabooZ80 Simulator Simple Calculator (簡易電卓)
; ============================================================================
;
; このプログラムは、キーパッドと7セグメントディスプレイを使用した
; 簡易的な電卓アプリケーションです。以下の数式演算をサポートします。
;   加算 (+), 減算 (-), 乗算 (*), 除算 (/)
;
; ■ ハードウェアマッピング
; 
; [Keypad] (Port 0x40 - 入力)
;   キーを押すと、インターフェースが入力を受け取り、割り込み(INT)が発生します。
;   キーコードのマッピングは以下の通りです：
;     0-9 : 数字入力
;     A   : リセット (Clear All)
;     B   : 加算 (+)
;     C   : 減算 (-)
;     D   : 乗算 (*)
;     #   : 除算 (/)
;     *   : 計算実行 (=)
;
; [7-Segment] (Port 0x10-0x17 - 出力)
;   計算結果や入力値を表示します。
;     0x10 : 左端 (符号表示用 - マイナスの時のみ点灯)
;     0x11 : 桁6 (最上位)
;     ...
;     0x17 : 桁0 (最下位)
;
; ============================================================================

    ; --- リセットベクタ (プログラム開始位置) ---
    ORG 0x0000
    JP START

    ; --- 割り込みベクタ (モード1) ---
    ; キーパッドが押されると、ハードウェアはRST 38Hを実行します
    ORG 0x0038
ISR_KEY:
    IN A, (0x40)            ; キーパッドのポートからキーコードを読み込む
    LD (LAST_KEY), A        ; メモリに保存
    LD A, 1
    LD (KEY_READY), A       ; フラグを立てる (メインループに通知)
    EI                      ; 割り込み許可 (次の入力のため)
    RETI                    ; 割り込み復帰

; ============================================================================

    ; --- メモリマップ (変数定義) ---
    ; RAMエリア (0x8000以降を使用)
    VAL_L   EQU 0x8000  ; 現在入力中の数値 (下位8bit)
    VAL_H   EQU 0x8001  ; 現在入力中の数値 (上位8bit)
    ACC_L   EQU 0x8002  ; 演算用アキュムレータ (下位8bit) - 計算結果など
    ACC_H   EQU 0x8003  ; 演算用アキュムレータ (上位8bit)
    OP_CODE EQU 0x8004  ; 演算子コード (0=なし, 1=+, 2=-, 3=*, 4=/)
    IS_NEW  EQU 0x8005  ; 新規入力フラグ (1なら次の数字入力でVALをクリア)
    LAST_KEY EQU 0x8006 ; 最後に押されたキーコード
    KEY_READY EQU 0x8007 ; キー入力済みフラグ

    ; --- 定数 (演算コード) ---
    KEY_NONE EQU 0xFF
    OP_NONE  EQU 0
    OP_ADD   EQU 1
    OP_SUB   EQU 2
    OP_MUL   EQU 3
    OP_DIV   EQU 4

    ; --- プログラム開始 (START) ---
START:
    LD SP, 0xFFFF           ; スタックポインタ初期化
    CALL RESET_ALL          ; 変数・表示の初期化
    IM 1                    ; 割り込みモード1 (RST 38H) に設定
    EI                      ; 割り込み有効化

; ----------------------------------------------------------------------------
; メインループ (イベント待ち受け)
; ----------------------------------------------------------------------------
MAIN_LOOP:
    ; キー入力待ち (割り込み処理で KEY_READY が 1 になるのを待つ)
    LD A, (KEY_READY)
    OR A
    JR Z, MAIN_LOOP
    
    ; キー入力あり
    XOR A
    LD (KEY_READY), A       ; フラグクリア (二重処理防止)
    
    ; キー処理実行
    LD A, (LAST_KEY)
    CALL PROCESS_KEY        ; キーの内容に応じて計算や数値追加
    CALL UPDATE_DISPLAY     ; 画面更新
    
    JR MAIN_LOOP            ; 繰り返し

; ============================================================================
; キー入力処理ルーチン (PROCESS_KEY)
; 入力 A : キーコード
; ============================================================================
PROCESS_KEY:
    ; 特殊キー(演算子など)の判定
    CP 12           ; '*' キー (キーコード12) -> イコール(=)扱い
    JP Z, KEY_EQ
    CP 14           ; '#' キー (キーコード14) -> 除算(/)扱い
    JP Z, KEY_DIV
    CP 15           ; 'D' キー (キーコード15) -> 乗算(*)扱い
    JP Z, KEY_MUL
    CP 11           ; 'C' キー (キーコード11) -> 減算(-)扱い
    JP Z, KEY_SUB
    CP 7            ; 'B' キー (キーコード7)  -> 加算(+)扱い
    JP Z, KEY_ADD
    CP 3            ; 'A' キー (キーコード3)  -> リセット(AC)扱い
    JP Z, RESET_ALL
    
    ; 数字キーの処理
    ; キーコードを実際の数値(0-9)に変換します
    LD B, A         ; キーコードを保存
    LD HL, KEY_MAP  ; 変換テーブル
    LD C, 0         ; カウンタ (数値)
MAP_LOOP:
    LD A, (HL)
    CP 0xFF         ; テーブル終端
    RET Z           ; 無効なキーなら無視
    CP B            ; キーコード一致？
    JR Z, FOUND_DIGIT
    INC HL
    INC C
    JR MAP_LOOP

FOUND_DIGIT:
    LD A, C         ; A レジスタに数値 (0-9) が入る
    
    ; 新規入力モードかチェック (演算子を押した直後など)
    LD HL, IS_NEW
    LD B, (HL)
    LD (HL), 0      ; フラグクリア
    LD A, B
    OR A
    JR Z, APPEND_DIGIT
    
    ; 新しい数値入力開始 -> 現在の入力値(VAL)をクリア
    LD HL, 0
    LD (VAL_L), HL
    
APPEND_DIGIT:
    ; 入力値の更新: VAL = VAL * 10 + Digit
    LD HL, (VAL_L)
    
    ; HL = HL * 10
    PUSH HL
    POP DE          ; DE = HL
    ADD HL, HL      ; HL * 2
    ADD HL, HL      ; HL * 4
    ADD HL, DE      ; HL * 5
    ADD HL, HL      ; HL * 10
    
    LD A, C         ; 追加する桁の数値
    LD E, A
    LD D, 0
    ADD HL, DE      ; HL + Digit
    
    LD (VAL_L), HL  ; 保存
    RET


; --- 演算子キー処理群 ---
KEY_ADD:
    LD A, OP_ADD
    JR DO_OP
KEY_SUB:
    LD A, OP_SUB
    JR DO_OP
KEY_MUL:
    LD A, OP_MUL
    JR DO_OP
KEY_DIV:
    LD A, OP_DIV
    JR DO_OP
KEY_EQ:
    LD A, OP_NONE
    ; Fallthrough (イコールの場合は演算予約なしで実行のみ)

DO_OP:
    LD C, A         ; 新しい演算子をCに保存
    
    ; 既に保留中の演算があれば実行 (例: 1 + 2 [+] -> この時点で 1+2 を計算)
    LD A, (OP_CODE)
    OR A
    JR Z, SET_NEW_OP
    
    ; 保留中の計算を実行: ACC = ACC <OP> VAL
    CALL EXEC_OP
    
    ; 結果を入力値(VAL)にコピーして表示させる
    LD HL, (ACC_L)
    LD (VAL_L), HL
    
SET_NEW_OP:
    LD A, C
    LD (OP_CODE), A ; 次の演算子を保存
    
    ; 現在の値をアキュムレータ(ACC)へ移動
    LD HL, (VAL_L)
    LD (ACC_L), HL
    
    ; 次の数字入力でVALをクリアするためのフラグセット
    LD A, 1
    LD (IS_NEW), A
    RET

; --- 計算実行ルーチン ---
EXEC_OP:
    LD HL, (ACC_L)  ; 左辺 (被演算子)
    LD DE, (VAL_L)  ; 右辺 (演算子)
    
    LD A, (OP_CODE)
    CP OP_ADD
    JR Z, OP_ADD_IMPL
    CP OP_SUB
    JR Z, OP_SUB_IMPL
    CP OP_MUL
    JR Z, OP_MUL_IMPL
    CP OP_DIV
    JR Z, OP_DIV_IMPL
    RET

OP_ADD_IMPL: ; 加算
    ADD HL, DE
    LD (ACC_L), HL
    RET

OP_SUB_IMPL: ; 減算
    OR A            ; キャリークリア
    SBC HL, DE
    LD (ACC_L), HL
    RET

OP_MUL_IMPL: ; 乗算 (符号なし16bit)
    ; HL = HL * DE
    ; シフト加算アルゴリズム
    LD B, H
    LD C, L         ; BC = 左辺
    LD HL, 0        ; 結果初期化
    LD A, 16        ; 16ビット分ループ
MUL_LOOP:
    ADD HL, HL      ; 結果を左シフト
    EX DE, HL
    ADD HL, HL      ; 右辺(DE)を左シフトして最上位ビットをCarryへ
    EX DE, HL
    JR NC, NO_ADD   ; Carryがなければ加算スキップ
    ADD HL, BC      ; 結果に左辺を加算
NO_ADD:
    DEC A
    JR NZ, MUL_LOOP
    LD (ACC_L), HL
    RET

OP_DIV_IMPL: ; 除算 (符号なし16bit)
    ; HL = HL / DE
    ; 0除算チェック
    LD A, D
    OR E
    RET Z           ; 0除算なら何もしない
    
    ; 割り算の準備
    ; HL = 被除数 (Dividend) -> ACC
    ; DE = 除数 (Divisor)   -> VAL
    
    ; 筆算アルゴリズム用レジスタ割り当て変更
    LD B, D
    LD C, E         ; BC = 除数
    LD DE, 0        ; DE = 余り (Remainder) 初期化
    
    LD A, 16        ; ループ回数
    AND A           ; キャリークリア

DIV_LOOP:
    ; 1. 被除数(HL)を左シフト。MSBがキャリーへ。
    ADD HL, HL
    
    ; 2. 余り(DE)を左シフトし、下位ビットにキャリーを取り込む
    EX DE, HL
    ADC HL, HL
    EX DE, HL
    
    ; 3. 余りから除数を引けるか試行 (DE - BC)
    PUSH HL         ; HL(商/被除数)を退避
    LD H, D
    LD L, E         ; HL = 余り
    OR A            ; キャリークリア
    SBC HL, BC      ; 余り - 除数
    
    JR C, DIV_SKIP  ; 引けない(Carry発生)ならスキップ
    
    ; 引けた場合
    LD D, H
    LD E, L         ; 新しい余りをDEに戻す
    
    POP HL          ; HL復帰
    INC HL          ; 商の最下位ビットを1にする
    JR DIV_NEXT_ITER

DIV_SKIP:
    POP HL          ; HL復帰 (ビットは0のまま)

DIV_NEXT_ITER:
    DEC A
    JR NZ, DIV_LOOP
    
    ; HLが商、DEが余りになります
    LD (ACC_L), HL
    RET

; --- 全リセット処理 ---
RESET_ALL:
    LD HL, 0
    LD (VAL_L), HL
    LD (ACC_L), HL
    LD A, 0
    LD (OP_CODE), A
    LD (IS_NEW), A
    LD (KEY_READY), A
    CALL UPDATE_DISPLAY
    RET

; ============================================================================
; 表示更新ルーチン (7セグメント制御)
; ============================================================================
UPDATE_DISPLAY:
    LD HL, (VAL_L)
    
    ; 負の数チェック
    BIT 7, H
    JR Z, POSITIVE
    ; 負の場合
    LD A, 0x40      ; '-' のセグメントパターン
    OUT (0x10), A   ; 符号桁(ポート0x10)に出力
    
    ; 表示用に数値を正の数(絶対値)に変換 (2の補数)
    LD A, H
    CPL
    LD H, A
    LD A, L
    CPL
    LD L, A
    INC HL
    JR DISP_VAL
POSITIVE:
    LD A, 0         ; 消灯
    OUT (0x10), A   ; 符号桁

DISP_VAL:
    ; HLの値をBCD(10進数)の各桁に分解して表示
    ; 右端(ポート0x17)から順に埋めていきます
    
    LD C, 0x17      ; 開始ポート (右端)
    LD B, 7         ; 最大7桁 (0x17 -> 0x11)
    
CONV_LOOP:
    ; HL ÷ 10 を行い、余り(A)を表示
    CALL DIV_10     ; HL=商, A=余り
    
    PUSH HL         ; 商を保存
    
    ; 余り(0-9)をセグメントパターンに変換
    LD HL, SEG_MAP
    LD E, A
    LD D, 0
    ADD HL, DE
    LD A, (HL)
    OUT (C), A      ; 出力
    DEC C           ; 次の桁へ (左隣)
    
    POP HL          ; 商を復帰
    
    ; ゼロサプレス処理 (上位桁の不要な0を消す)
    ; 商(HL)が0なら残りは空白にする
    LD A, H
    OR L
    JR NZ, NOT_ZERO
    
    ; 商が0になったので、残りの桁を空白埋め
    DEC B           ; 今表示した桁をカウントから除く
    JP Z, DISP_DONE ; 全桁完了なら終了
    
BLANK_LOOP:
    XOR A           ; 0x00 (Blank)
    OUT (C), A
    DEC C
    DJNZ BLANK_LOOP
    RET             ; 終了

NOT_ZERO:
    DJNZ CONV_LOOP  ; 次の桁へ
    RET

DISP_DONE:
    RET

; [ヘルパー] HL = HL / 10, A = 余り
DIV_10:
    PUSH BC
    LD B, 16        ; 16ビット分
    LD C, 10        ; 除数
    XOR A           ; 余り初期化
D10_LOOP:
    ADD HL, HL      ; 被除数シフト
    RLA             ; 余りシフト(キャリー込み)
    CP C            ; 余り >= 10 ?
    JR C, D10_NEXT
    SUB C           ; 余り - 10
    INC L           ; 商のビットを立てる
D10_NEXT:
    DJNZ D10_LOOP
    POP BC
    RET

; --- データテーブル ---

; 数値 -> 7セグメントパターン変換表
; (g f e d c b a) のビット対応
SEG_MAP:
    DB 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F

; キーコード -> 数値(0-9)変換表
; インデックスが数値、値が対応するキーコード
KEY_MAP:
    DB 13       ; 0 のキーコード
    DB 0        ; 1
    DB 1        ; 2
    DB 2        ; 3
    DB 4        ; 4
    DB 5        ; 5
    DB 6        ; 6
    DB 8        ; 7
    DB 9        ; 8
    DB 10       ; 9
    DB 0xFF     ; 終端
