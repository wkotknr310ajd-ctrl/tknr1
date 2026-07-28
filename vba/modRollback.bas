Attribute VB_Name = "modRollback"
Option Explicit

' 「ロールバック」シートの承認済み一覧を履歴シートから再構築する。
Public Sub RefreshApprovedList()
    Dim hist As Worksheet, rb As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Set rb = ThisWorkbook.Sheets("ロールバック")

    Const FIRST_DATA_ROW As Long = 12

    Dim lastClear As Long
    lastClear = rb.Cells(rb.Rows.Count, 1).End(xlUp).Row
    If lastClear >= FIRST_DATA_ROW Then
        rb.Range(rb.Cells(FIRST_DATA_ROW, 1), rb.Cells(lastClear, 8)).ClearContents
    End If

    Dim lastHistRow As Long
    lastHistRow = hist.Cells(hist.Rows.Count, 1).End(xlUp).Row

    Dim outRow As Long
    outRow = FIRST_DATA_ROW
    Dim r As Long
    For r = 2 To lastHistRow
        If CStr(hist.Cells(r, 9).Value) = "承認" Then
            rb.Cells(outRow, 1).Value = hist.Cells(r, 1).Value   ' 申請ID
            rb.Cells(outRow, 2).Value = hist.Cells(r, 3).Value   ' 申請者
            rb.Cells(outRow, 3).Value = hist.Cells(r, 4).Value   ' 対象者
            rb.Cells(outRow, 4).Value = hist.Cells(r, 5).Value   ' 対象日
            rb.Cells(outRow, 4).NumberFormat = "yyyy/mm/dd"
            rb.Cells(outRow, 5).Value = hist.Cells(r, 6).Value   ' 変更前
            rb.Cells(outRow, 6).Value = hist.Cells(r, 7).Value   ' 変更後(現在値)
            rb.Cells(outRow, 7).Value = hist.Cells(r, 10).Value  ' 承認者
            rb.Cells(outRow, 8).Value = hist.Cells(r, 11).Value  ' 承認日時
            rb.Cells(outRow, 8).NumberFormat = "yyyy/mm/dd hh:mm:ss"
            outRow = outRow + 1
        End If
    Next r

    Dim lastRow As Long
    lastRow = rb.Cells(rb.Rows.Count, 1).End(xlUp).Row
    With rb.Range("B3").Validation
        .Delete
        If lastRow >= FIRST_DATA_ROW Then
            .Add Type:=xlValidateList, AlertStyle:=xlValidAlertStop, _
                 Formula1:="=ロールバック!$A$" & FIRST_DATA_ROW & ":$A$" & lastRow
        End If
    End With
End Sub

' 承認済みの申請(同一申請IDの履歴行、単独申請なら1行・交換申請なら2行)をまとめて取り消し、
' シフト表を変更前の値に戻す。取り消し操作自体も新しい履歴として必ず記録する
' (誰が・いつ・誰の・どの申請を取り消したか)。
Public Sub RollbackChange()
    Dim rb As Worksheet
    Set rb = ThisWorkbook.Sheets("ロールバック")

    Dim targetId As String, apprName As String, pwd As String
    targetId = Trim$(CStr(rb.Range("B3").Value))
    apprName = Trim$(CStr(rb.Range("B4").Value))
    pwd = CStr(rb.Range("B5").Value)

    If targetId = "" Or apprName = "" Then
        MsgBox "対象の申請IDと承認者氏名を入力してください。", vbExclamation
        Exit Sub
    End If

    Dim masterWs As Worksheet
    Set masterWs = ThisWorkbook.Sheets("職員マスタ")
    Dim staffRow As Long
    staffRow = FindStaffMasterRow(apprName)
    If staffRow = 0 Then
        MsgBox apprName & " は職員マスタに登録されていません。", vbCritical
        Exit Sub
    End If
    If InStr(CStr(masterWs.Cells(staffRow, 2).Value), "承認者") = 0 Then
        MsgBox apprName & " には承認権限がありません(取り消しにも承認権限が必要です)。", vbCritical
        Exit Sub
    End If

    Dim salt As String, storedHash As String
    salt = CStr(masterWs.Cells(staffRow, 3).Value)
    storedHash = CStr(masterWs.Cells(staffRow, 4).Value)
    If Not VerifyPassword(pwd, salt, storedHash) Then
        MsgBox "パスワードが正しくありません。", vbCritical
        rb.Range("B5").Value = ""
        Exit Sub
    End If

    Dim hist As Worksheet
    Set hist = ThisWorkbook.Sheets("履歴")
    Dim rows As Collection
    Set rows = FindHistoryRowsById(targetId)
    If rows.Count = 0 Then
        MsgBox "対象の申請が見つかりません。", vbCritical
        Exit Sub
    End If

    Dim rw As Variant
    Dim r As Long
    For Each rw In rows
        If CStr(hist.Cells(CLng(rw), 9).Value) <> "承認" Then
            MsgBox "承認済みの申請のみ取り消せます。", vbExclamation
            Exit Sub
        End If
    Next rw

    Dim confirmMsg As String
    For Each rw In rows
        r = CLng(rw)
        confirmMsg = confirmMsg & CStr(hist.Cells(r, 4).Value) & "(" & Format(CDate(hist.Cells(r, 5).Value), "m/d") & _
                     "): 「" & hist.Cells(r, 7).Value & "」→「" & hist.Cells(r, 6).Value & "」に戻す" & vbCrLf
    Next rw

    If MsgBox("申請ID " & targetId & " の以下の変更を取り消します。" & vbCrLf & confirmMsg & vbCrLf & "よろしいですか?", _
              vbYesNo + vbQuestion) = vbNo Then
        Exit Sub
    End If

    Dim shiftWs As Worksheet
    Set shiftWs = ThisWorkbook.Sheets("シフト表")

    Dim n As Long
    n = rows.Count
    Dim shiftRows() As Long, shiftCols() As Long, beforeShifts() As String
    Dim targetPersons() As String, targetDates() As Date, afterShifts() As String
    ReDim shiftRows(1 To n)
    ReDim shiftCols(1 To n)
    ReDim beforeShifts(1 To n)
    ReDim targetPersons(1 To n)
    ReDim targetDates(1 To n)
    ReDim afterShifts(1 To n)

    Dim staffName As String, targetDate As Date, beforeShift As String, afterShift As String
    Dim sRow As Long, sCol As Long
    Dim actualCurrent As String
    Dim conflictMsg As String
    Dim idx As Long
    idx = 0
    For Each rw In rows
        idx = idx + 1
        r = CLng(rw)
        staffName = CStr(hist.Cells(r, 4).Value)
        targetDate = CDate(hist.Cells(r, 5).Value)
        beforeShift = CStr(hist.Cells(r, 6).Value)
        afterShift = CStr(hist.Cells(r, 7).Value)

        sRow = FindShiftStaffRow(staffName)
        sCol = FindShiftDayColumn(Day(targetDate))
        If sRow = 0 Or sCol = 0 Then
            MsgBox "シフト表の対象セルが見つかりません(" & staffName & ")。", vbCritical
            Exit Sub
        End If
        shiftRows(idx) = sRow
        shiftCols(idx) = sCol
        beforeShifts(idx) = beforeShift
        targetPersons(idx) = staffName
        targetDates(idx) = targetDate
        afterShifts(idx) = afterShift

        actualCurrent = CStr(shiftWs.Cells(sRow, sCol).Value)
        If actualCurrent <> afterShift Then
            conflictMsg = conflictMsg & staffName & "(" & Format(targetDate, "m/d") & "): 現在「" & actualCurrent & _
                          "」/ 承認時の反映値「" & afterShift & "」" & vbCrLf
        End If
    Next rw

    If conflictMsg <> "" Then
        If MsgBox("シフト表の現在値が承認時と異なる箇所があります。" & vbCrLf & conflictMsg & vbCrLf & _
                  "このまま元に戻してよろしいですか?", vbYesNo + vbExclamation) = vbNo Then
            Exit Sub
        End If
    End If

    Dim newId As String
    newId = NextRequestId()

    idx = 0
    For Each rw In rows
        idx = idx + 1
        r = CLng(rw)
        shiftWs.Cells(shiftRows(idx), shiftCols(idx)).Value = beforeShifts(idx)
        hist.Cells(r, 9).Value = "取消(ロールバック)"

        AppendHistoryRow newId, Now, apprName, targetPersons(idx), targetDates(idx), _
                          afterShifts(idx), beforeShifts(idx), _
                          "ロールバックによる取消(元申請: " & targetId & ")", "取消完了", apprName, Now, targetId
    Next rw

    MsgBox "取り消しました。シフト表を元の状態に戻しました。(" & n & "件)", vbInformation

    rb.Range("B3").Value = ""
    rb.Range("B5").Value = ""

    RefreshPendingList
    RefreshApprovedList
    ThisWorkbook.Save
End Sub
